// recorder — capture a human's clicks/fills in the Browserbase Live View so a
// human-resolved handoff becomes a reusable recipe, with NO AI on the next run.
//
// THE HITL MAGIC. When the engine parks at awaiting_human (captcha, login wall, a
// form it couldn't fill) the person finishes the form live in the SAME Browserbase
// session. This module injects a recorder into that session's pages so every click,
// input and change the human makes is captured as a recordedActions entry — the
// same raw material distill_recipe (#64) compresses into a MerchantRecipe. Next
// time that merchant needs invoicing, replay_recipe drives the form deterministically.
//
// We do NOT use Browserbase's recording API (rrweb, deprecated). We inject our own
// recorder via Playwright's addInitScript + exposeBinding:
//
//   - addInitScript installs the in-page recorder on EVERY new document, so it
//     survives the navigations the human performs while working the form.
//   - exposeBinding lets the in-page script stream actions back to Node when a
//     client is attached (live mode).
//   - The in-page recorder ALSO buffers every action in window + sessionStorage, so
//     it keeps recording while the durable run is SUSPENDED on the HITL waitpoint
//     (no Node process is connected then). On resume the engine reconnects and
//     drainRecordedActions() reads the buffer back out.
//
// Selector quality is the key risk — replay can only self-heal if each element was
// captured with several independent strategies. So for every element the recorder
// computes a multi-strategy selector { css, xpath, text, attributes:{ id, name,
// ariaLabel, placeholder, type } }, matching the MerchantRecipe selector schema.
//
// Each captured value is mapped to a billing dataKey (#56): a typed value that
// equals an assembled billing field becomes that dataKey (so replay writes THIS
// ticket's value, not the human's); a value with no billing match (a régimen choice,
// a "Facturar" click) stays a literal staticValue.

import {
  getBillingValue,
  BILLING_DATA_KEYS,
} from "@/libs/engine/billingData";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:recorder" });

// In-page globals/keys the injected recorder uses. Namespaced so they can't collide
// with portal scripts. Shared with the drain reader below via RECORDER_CONFIG.
const BINDING_NAME = "__facturinRecord";
const STORAGE_KEY = "__facturinRecordedActions";
const BUFFER_KEY = "__facturinRecorderBuffer";
const TAG_ATTR = "data-fctr-rec";
const INSTALLED_FLAG = "__facturinRecorderInstalled";

const RECORDER_CONFIG = Object.freeze({
  binding: BINDING_NAME,
  storageKey: STORAGE_KEY,
  bufferKey: BUFFER_KEY,
  tagAttr: TAG_ATTR,
  installedFlag: INSTALLED_FLAG,
});

/**
 * The recorder program — runs IN THE BROWSER, never in Node. It is serialized with
 * Function.prototype.toString() and injected via addInitScript / evaluate, so it
 * must be self-contained: no imports, no module closure, only browser globals and
 * the `config` argument. Written in ES5 style for maximum portability.
 *
 * It installs (once per document) capture-phase listeners for click / change /
 * input, computes a multi-strategy selector + value for each, and appends a
 * recordedActions entry to a buffer mirrored on window AND sessionStorage (so it
 * survives navigations and a disconnected Node client). It also streams each action
 * to the exposed binding when one is connected.
 */
function recorderProgram(config) {
  // Idempotent per document: addInitScript + an explicit evaluate could both fire.
  if (window[config.installedFlag]) return;
  window[config.installedFlag] = true;

  var BINDING = config.binding;
  var SKEY = config.storageKey;
  var BKEY = config.bufferKey;
  var ATTR = config.tagAttr;

  // Rehydrate the running buffer from the most complete of localStorage (origin-wide,
  // shared across tabs of the same origin — survives the human opening the form in a
  // new tab), sessionStorage (per-tab, survives same-origin navigations), or the
  // window mirror. Take the LONGEST so no source silently truncates the history.
  function parseList(raw) {
    try {
      var a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  }
  function loadBuffer() {
    var best = [];
    try {
      var ls = parseList(window.localStorage.getItem(SKEY));
      if (ls.length > best.length) best = ls;
    } catch (e) {
      /* localStorage blocked — fall through */
    }
    try {
      var ss = parseList(window.sessionStorage.getItem(SKEY));
      if (ss.length > best.length) best = ss;
    } catch (e) {
      /* sessionStorage blocked — fall through */
    }
    if (window[BKEY] && window[BKEY].length > best.length) best = window[BKEY];
    return best;
  }

  var buffer = loadBuffer();
  window[BKEY] = buffer;

  function persist() {
    window[BKEY] = buffer;
    // Write BOTH stores: sessionStorage for in-tab navigations, localStorage so a
    // resumed drain (or a different same-origin tab) can recover the full buffer even
    // after the Node client disconnected during the suspend.
    try {
      window.sessionStorage.setItem(SKEY, JSON.stringify(buffer));
    } catch (e) {
      /* over quota / blocked — the window mirror + localStorage still hold it */
    }
    try {
      window.localStorage.setItem(SKEY, JSON.stringify(buffer));
    } catch (e) {
      /* over quota / blocked — the window mirror + sessionStorage still hold it */
    }
  }

  function emit(action) {
    try {
      if (typeof window[BINDING] === "function") window[BINDING](action);
    } catch (e) {
      /* no client attached (suspended run) — the buffer is the source of truth */
    }
  }

  function pushAction(action) {
    buffer.push(action);
    persist();
    emit(action);
  }

  // Stable per-element key so repeated input events on the same field update one
  // entry (latest value wins) instead of appending a step per keystroke.
  //
  // CRITICAL: recorderProgram re-runs FRESH on every new document (addInitScript),
  // but `buffer` is rehydrated across navigations from sessionStorage. A counter that
  // restarted at 0 would re-mint "e1","e2",... on page 2 and collide with page 1's
  // keys still in the buffer — recordValue's coalesce loop would then OVERWRITE the
  // earlier page's fill instead of appending a new one (lost actions on multi-page
  // CFDI/SAT forms). Seed the counter ABOVE every ordinal already in the buffer so
  // keys stay unique across navigations while still coalescing within a document.
  var counter = 0;
  for (var _i = 0; _i < buffer.length; _i++) {
    var _k = buffer[_i] && buffer[_i]._key;
    var _m = _k ? /^e(\d+)/.exec(_k) : null;
    if (_m) {
      var _ord = parseInt(_m[1], 10);
      if (_ord > counter) counter = _ord;
    }
  }
  function keyFor(el) {
    var k = el.getAttribute(ATTR);
    if (!k) {
      counter += 1;
      k = "e" + counter;
      try {
        el.setAttribute(ATTR, k);
      } catch (e) {
        /* read-only element — fall back to a positional key */
        k = "e" + counter + "_anon";
      }
    }
    return k;
  }

  function attrOf(el, a) {
    try {
      var v = el.getAttribute(a);
      return v == null || v === "" ? null : v;
    } catch (e) {
      return null;
    }
  }

  function cssEscape(s) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  // A reasonably stable CSS path: short-circuit to #id, else a tag chain that
  // prefers [name] and falls back to :nth-of-type, capped in depth.
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return "#" + cssEscape(el.id);
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      if (node.id) {
        parts.unshift("#" + cssEscape(node.id));
        break;
      }
      var sel = node.tagName.toLowerCase();
      var name = attrOf(node, "name");
      if (name) {
        parts.unshift(sel + '[name="' + name + '"]');
        node = node.parentElement;
        depth += 1;
        continue;
      }
      var parent = node.parentElement;
      if (parent) {
        var same = [];
        var kids = parent.children;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].tagName === node.tagName) same.push(kids[i]);
        }
        if (same.length > 1) {
          var idx = 0;
          for (var j = 0; j < same.length; j++) {
            if (same[j] === node) {
              idx = j + 1;
              break;
            }
          }
          if (idx) sel += ":nth-of-type(" + idx + ")";
        }
      }
      parts.unshift(sel);
      node = parent;
      depth += 1;
    }
    return parts.length ? parts.join(" > ") : null;
  }

  // Absolute XPath as a last-resort fallback strategy.
  function xPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '//*[@id="' + el.id + '"]';
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== "html") {
      var i = 1;
      var sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) i += 1;
        sib = sib.previousElementSibling;
      }
      parts.unshift(node.tagName.toLowerCase() + "[" + i + "]");
      node = node.parentElement;
    }
    return parts.length ? "/html/" + parts.join("/") : null;
  }

  function textFor(el) {
    var t = (el.innerText || el.textContent || "").trim();
    if (!t) t = attrOf(el, "aria-label") || attrOf(el, "title") || attrOf(el, "value") || "";
    t = String(t).replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 80) : null;
  }

  function selectorFor(el) {
    var attributes = {
      id: el.id || null,
      name: attrOf(el, "name"),
      ariaLabel: attrOf(el, "aria-label"),
      placeholder: attrOf(el, "placeholder"),
      type: attrOf(el, "type") || el.tagName.toLowerCase(),
    };
    return {
      css: cssPath(el),
      xpath: xPath(el),
      text: textFor(el),
      attributes: attributes,
    };
  }

  function fieldTypeOf(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    return (attrOf(el, "type") || "text").toLowerCase();
  }

  var TEXT_INPUT_TYPES = [
    "text",
    "email",
    "number",
    "tel",
    "search",
    "url",
    "password",
    "date",
    "month",
    "week",
    "time",
    "datetime-local",
  ];

  function isValueControl(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "select" || tag === "textarea") return true;
    if (tag === "input") {
      var t = (attrOf(el, "type") || "text").toLowerCase();
      return TEXT_INPUT_TYPES.indexOf(t) >= 0;
    }
    return !!el.isContentEditable;
  }

  function isClickable(el) {
    var tag = el.tagName.toLowerCase();
    if (["button", "a", "summary", "option", "label"].indexOf(tag) >= 0) return true;
    var role = (attrOf(el, "role") || "").toLowerCase();
    if (["button", "link", "tab", "menuitem", "menuitemradio", "option", "checkbox", "radio", "switch"].indexOf(role) >= 0) {
      return true;
    }
    if (tag === "input") {
      var t = (attrOf(el, "type") || "text").toLowerCase();
      return ["submit", "button", "reset", "checkbox", "radio", "image"].indexOf(t) >= 0;
    }
    return false;
  }

  // Walk up a few levels so a click on an icon inside a <button> records the button.
  function closestInteractive(el) {
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      if (isClickable(node)) return node;
      node = node.parentElement;
      depth += 1;
    }
    return null;
  }

  function recordValue(el) {
    var tag = el.tagName.toLowerCase();
    var val = el.isContentEditable
      ? (el.innerText || "").trim()
      : el.value != null
        ? String(el.value)
        : "";
    var key = keyFor(el);
    // Update this element's existing entry if present (coalesce keystrokes).
    for (var i = 0; i < buffer.length; i++) {
      if (
        buffer[i]._key === key &&
        (buffer[i].action === "fill" || buffer[i].action === "select")
      ) {
        buffer[i].value = val;
        persist();
        emit(buffer[i]);
        return;
      }
    }
    pushAction({
      action: tag === "select" ? "select" : "fill",
      selector: selectorFor(el),
      value: val,
      fieldType: fieldTypeOf(el),
      source: "human",
      _key: key,
    });
  }

  document.addEventListener(
    "click",
    function (ev) {
      try {
        var target = ev.target;
        if (!target || target.nodeType !== 1) return;
        // A click into a text field is just focus — its value is captured on change.
        if (isValueControl(target)) return;
        var el = closestInteractive(target) || target;
        if (isValueControl(el)) return;
        pushAction({
          action: "click",
          selector: selectorFor(el),
          description: textFor(el),
          source: "human",
        });
      } catch (e) {
        /* never let recording break the human's interaction */
      }
    },
    true
  );

  function onValueEvent(ev) {
    try {
      var el = ev.target;
      if (!el || el.nodeType !== 1) return;
      var tag = el.tagName.toLowerCase();
      var t = (attrOf(el, "type") || "").toLowerCase();
      // Checkbox/radio: the value is the SELECTION, so replay it as a click.
      if (tag === "input" && (t === "checkbox" || t === "radio")) {
        pushAction({
          action: "click",
          selector: selectorFor(el),
          description: textFor(el) || el.value || null,
          source: "human",
        });
        return;
      }
      if (!isValueControl(el)) return;
      recordValue(el);
    } catch (e) {
      /* swallow — recording is best-effort */
    }
  }
  document.addEventListener("change", onValueEvent, true);
  document.addEventListener("input", onValueEvent, true);

  // Record the document's own URL as a navigate step so the recipe can jump
  // straight to the form on replay. Deduped against the last navigate.
  try {
    var href = location.href;
    var lastNav = null;
    for (var n = buffer.length - 1; n >= 0; n--) {
      if (buffer[n].action === "navigate") {
        lastNav = buffer[n].staticValue;
        break;
      }
    }
    if (href && href !== lastNav) {
      pushAction({
        action: "navigate",
        staticValue: href,
        source: "human",
        description: "page loaded during human takeover",
      });
    }
  } catch (e) {
    /* location unavailable — skip the nav step */
  }
}

// The injected source: the program above, invoked with our config. Built once.
const RECORDER_SOURCE = `(${recorderProgram.toString()})(${JSON.stringify(
  RECORDER_CONFIG
)})`;

/**
 * Inject the recorder into a live session so the human's interactions are captured.
 *
 * Installs the recorder on the page's context (current + future pages and tabs) via
 * addInitScript, exposes the streaming binding, and runs it once on the CURRENT
 * document (addInitScript only affects documents loaded AFTER it). All best-effort:
 * a failure to attach must never break the handoff — the run can still resume from
 * whatever the client posts.
 *
 * @param {import("playwright").Page} page - A live Stagehand page (getActivePage()).
 * @param {Object} [opts]
 * @param {(action: Object) => void} [opts.onAction] - Optional Node sink for the
 *   live binding stream (used when a client stays attached; the HITL handoff
 *   suspends instead and reads the buffer back via drainRecordedActions).
 * @returns {Promise<boolean>} Whether the recorder was attached.
 */
export async function attachRecorder(page, { onAction } = {}) {
  if (!page) return false;
  const target =
    typeof page.context === "function" && page.context() ? page.context() : page;

  try {
    // exposeBinding: stream actions to Node when a client is attached. Throws if the
    // name is already bound (re-attach) — non-fatal, buffering still works.
    try {
      await target.exposeBinding(BINDING_NAME, (_source, action) => {
        if (typeof onAction === "function") {
          try {
            onAction(action);
          } catch (err) {
            log.warn("recorder onAction sink threw", { error: String(err) });
          }
        }
      });
    } catch (err) {
      // Already exposed or unsupported — continue; the in-page buffer is primary.
    }

    // Re-inject on every navigation / new tab.
    await target.addInitScript(RECORDER_SOURCE);

    // Run on the document the human is already looking at.
    try {
      await page.evaluate(RECORDER_SOURCE);
    } catch (err) {
      // The current document may be mid-navigation; future ones still get it.
      log.warn("recorder: could not install on current document", {
        error: String(err),
      });
    }

    return true;
  } catch (err) {
    log.warn("recorder: attach failed", { error: String(err) });
    return false;
  }
}

/**
 * Read the buffered actions back out of a session and shape them for distillation.
 *
 * Called on HITL resume: reconnect to the session the human used, then read the
 * recorder's buffer (sessionStorage, falling back to the window mirror), normalize
 * the raw entries, and — when billingData is provided — map each captured value to a
 * billing dataKey. Best-effort: returns [] if nothing was captured or the page is
 * unreadable.
 *
 * @param {import("playwright").Page} page - A live Stagehand page (getActivePage()).
 * @param {Object|null} [billingData] - Assembled billingData (#56) for dataKey mapping.
 * @returns {Promise<Array<Object>>} recordedActions entries ready for distill_recipe.
 */
export async function drainRecordedActions(page, billingData = null) {
  if (!page) return [];

  let raw = await readBufferFromPage(page);

  // If the active page yielded nothing, the human may have worked in another tab.
  // localStorage is origin-shared, so any same-origin page in the context recovers
  // the full buffer — try the rest before giving up.
  if (!raw.length) {
    try {
      const ctx = typeof page.context === "function" ? page.context() : null;
      const others = ctx && typeof ctx.pages === "function" ? ctx.pages() : [];
      for (const p of others) {
        if (p === page) continue;
        raw = await readBufferFromPage(p);
        if (raw.length) break;
      }
    } catch (err) {
      log.warn("recorder: scanning other tabs failed", { error: String(err) });
    }
  }

  // Diagnostic: the prod HITL loop relies on this to see whether the human's actions
  // were captured at all (an empty drain → distill_recipe skips with "no fill steps").
  log.info("recorder: drained", { rawActions: raw.length });

  const normalized = normalizeRecordedActions(raw);
  return billingData ? mapActionsToDataKeys(normalized, billingData) : normalized;
}

/**
 * Read one page's recorder buffer: the LONGEST of localStorage (origin-wide),
 * sessionStorage (per-tab), and the window mirror. Best-effort — returns [] if the
 * page is mid-navigation or unreadable.
 *
 * @param {import("playwright").Page} page
 * @returns {Promise<Array<Object>>}
 */
async function readBufferFromPage(page) {
  try {
    return await page.evaluate((cfg) => {
      function parse(s) {
        try {
          var a = s ? JSON.parse(s) : [];
          return Array.isArray(a) ? a : [];
        } catch (e) {
          return [];
        }
      }
      var best = [];
      try {
        var ls = parse(window.localStorage.getItem(cfg.storageKey));
        if (ls.length > best.length) best = ls;
      } catch (e) {
        /* blocked */
      }
      try {
        var ss = parse(window.sessionStorage.getItem(cfg.storageKey));
        if (ss.length > best.length) best = ss;
      } catch (e) {
        /* blocked */
      }
      var w = window[cfg.bufferKey] || [];
      if (w.length > best.length) best = w;
      return best;
    }, RECORDER_CONFIG);
  } catch (err) {
    log.warn("recorder: read buffer from page failed", { error: String(err) });
    return [];
  }
}

/** Strip in-page bookkeeping (_key) and coerce captured values to strings. */
export function normalizeRecordedActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((a) => a && typeof a === "object" && a.action)
    .map((a) => {
      const { _key, ...rest } = a;
      if (rest.value != null) rest.value = String(rest.value);
      return rest;
    });
}

/** Lowercase, trim, collapse whitespace — tolerant comparison key. Mirrors fill_form. */
function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Stringify a billing value the way fill_form writes it (Date → YYYY-MM-DD). */
function formatValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Digits-and-dot view of a value, for amount matching across currency formatting. */
function numericKey(value) {
  const s = String(value).replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : null;
}

/**
 * Build a value → dataKey lookup from assembled billingData. BILLING_DATA_KEYS order
 * is the tie-break priority, so the first key carrying a value owns it. Registers
 * both a normalized-string key and a numeric key (so "$1,234.50" matches total 1234.5).
 */
// Only genuine monetary amounts get a numeric (digits-only) index entry. Indexing
// non-amounts (rfc, taxRegime, postalCode, folio, date) by their digits would let a
// typed amount whose formatting differs from billingData's canonical string resolve
// to the wrong field — e.g. a typed total "$123.00" mapping onto folio "A-123".
const AMOUNT_KEYS = new Set(["total", "subtotal"]);

function buildValueIndex(billingData) {
  const byString = new Map();
  const byNumber = new Map();
  for (const key of BILLING_DATA_KEYS) {
    const formatted = formatValue(getBillingValue(billingData, key));
    if (formatted == null || formatted === "") continue;
    const sk = normalize(formatted);
    if (sk && !byString.has(sk)) byString.set(sk, key);
    if (!AMOUNT_KEYS.has(key)) continue;
    const nk = numericKey(formatted);
    if (nk && !byNumber.has(nk)) byNumber.set(nk, key);
  }
  return { byString, byNumber };
}

/**
 * Map captured fill/select values to billing dataKeys. A typed value that equals an
 * assembled billing field becomes that dataKey, so replay writes the NEXT ticket's
 * value — never the recording user's. An UNMATCHED fill/select is left without a
 * dataKey, and distill_recipe now DROPS it (it no longer freezes the literal as a
 * staticValue: that would write the recording user's data into another user's invoice
 * on replay — see distillRecipe.js). Matching is kept deliberately precise (exact
 * normalized string, numeric only for amounts) rather than fuzzy: a wrong match would
 * write the wrong field, which is worse than dropping the step. Click/navigate pass
 * through untouched.
 *
 * @param {Array<Object>} actions - Normalized recordedActions.
 * @param {Object} billingData - Assembled billingData (#56).
 * @returns {Array<Object>} Actions with `dataKey` set where a value matched.
 */
export function mapActionsToDataKeys(actions, billingData) {
  if (!Array.isArray(actions) || !billingData) return actions || [];
  const { byString, byNumber } = buildValueIndex(billingData);

  return actions.map((a) => {
    if (!a || (a.action !== "fill" && a.action !== "select")) return a;
    if (a.value == null || a.value === "") return a;

    const dataKey =
      byString.get(normalize(a.value)) ||
      (numericKey(a.value) ? byNumber.get(numericKey(a.value)) : null) ||
      null;

    return dataKey ? { ...a, dataKey } : a;
  });
}

export default attachRecorder;
