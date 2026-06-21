// distill_recipe — turn a successful ai/human fill into a reusable MerchantRecipe.
//
// THE CORE SAVINGS LOOP. It runs only after a non-recipe fill succeeds (the shell
// gates it on method !== "recipe"). It compresses the run's recordedActions — the
// nav steps reach_form captured walking to the form, plus the verified fill/click
// steps fill_form (or a human) captured filling it — into an ordered, versioned
// MerchantRecipe keyed on the merchant's rfcEmisor. The next ticket for that RFC
// then takes the deterministic replay path (replay_recipe, zero AI).
//
// Each recorded action becomes one recipe step with a multi-strategy selector
// (css / xpath / text / attributes, so replay can fall back and self-heal) and
// either a dataKey binding (the billing value to write) or a literal staticValue
// (a fixed URL/option). Actions that can't form a replayable, value-bearing step
// are dropped, so a recipe never carries dead weight that would abort replay.
//
// Self-heal: MerchantRecipe.createNewVersion creates the new version first, then
// deactivates every other active recipe for the RFC. So when this run followed a
// failed replay (the broken recipe self-deactivated or got superseded), the fresh
// recipe transparently takes over — at most one active recipe per RFC, newest wins.
//
// Best-effort by contract: the form is already filled, so a distillation problem
// (no RFC, nothing replayable, a DB hiccup) must NEVER fail the run. On any such
// problem this node logs and returns a normal (ok) stage explaining the skip,
// rather than throwing.

import connectMongoose from "@/libs/core/mongoose";
import MerchantRecipe from "@/models/MerchantRecipe";
import { INVOICE_STATUS, INVOICE_METHOD } from "@/libs/engine/state";
import { BILLING_DATA_KEYS } from "@/libs/engine/billingDataKeys";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:distill-recipe" });

// Fast membership test for valid billing dataKeys (the recipe schema constrains a
// step's dataKey enum to this set, so an unknown key would reject the whole recipe).
const VALID_DATA_KEYS = new Set(BILLING_DATA_KEYS);

// Map the many action verbs recordedActions can carry (fill_form's own names plus
// whatever the reach_form operator agent's tools were called) onto the closed set
// of MerchantRecipe step actions. Anything not here is not deterministically
// replayable and gets dropped.
const ACTION_ALIASES = Object.freeze({
  navigate: "navigate",
  goto: "navigate",
  "go-to": "navigate",
  go_to: "navigate",
  click: "click",
  tap: "click",
  press: "keypress",
  keypress: "keypress",
  key: "keypress",
  fill: "fill",
  type: "fill",
  input: "fill",
  select: "select",
  wait: "wait",
  waitfornavigation: "waitForNavigation",
});

// Step actions that write a billing value (need a dataKey or a literal staticValue).
const DATA_STEP_ACTIONS = new Set(["fill", "select"]);

/**
 * Normalize a merchant name for normalizedName: lowercase, strip diacritics, drop
 * punctuation, collapse whitespace. Mirrors resolvePortal/KnownMerchant so the
 * recipe's normalizedName matches the merchant registry's.
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First capture group of `re` against `value`, or null. */
function match1(value, re) {
  const m = String(value).match(re);
  return m ? m[1] : null;
}

/**
 * Normalize an already-structured multi-strategy selector (e.g. from the human
 * recorder, libs/engine/recorder.js) onto the recipe's selector shape, keeping only
 * the strategies actually present so it mirrors the string path's output.
 *
 * @param {Object} sel - A { css, xpath, text, attributes } selector partial.
 * @returns {Object|null}
 */
function normalizeSelectorObject(sel) {
  const out = {};
  if (sel.css) out.css = String(sel.css);
  if (sel.xpath) out.xpath = String(sel.xpath).replace(/^xpath=/i, "");
  if (sel.text) out.text = String(sel.text);

  const a = sel.attributes || {};
  const attributes = {};
  for (const k of ["id", "name", "ariaLabel", "placeholder", "type"]) {
    if (a[k] != null && a[k] !== "") attributes[k] = String(a[k]);
  }
  if (Object.keys(attributes).length) out.attributes = attributes;

  return Object.keys(out).length ? out : null;
}

/**
 * Turn a selector into the recipe's multi-strategy shape { css, xpath, text,
 * attributes }. Accepts either a structured selector object (the human recorder
 * already computes all strategies — pass it straight through) or a raw string (as
 * Stagehand observe()/the agent hands them back). For a string, XPath forms land in
 * `xpath`; everything else is treated as CSS, from which we also recover
 * id/name/aria-label/placeholder/type attributes so replay's resolveSelector has
 * fallback strategies to self-heal with.
 *
 * @param {string|Object|null|undefined} raw
 * @returns {Object|null} A selector partial, or null when there's nothing to target.
 */
function toRecipeSelector(raw) {
  if (raw == null) return null;
  // Already a structured multi-strategy selector (human recorder) — keep all strategies.
  if (typeof raw === "object") return normalizeSelectorObject(raw);

  const selector = String(raw).trim();
  if (!selector) return null;

  // XPath: an explicit `xpath=` prefix, or a leading path/axis token.
  if (/^xpath=/i.test(selector)) {
    return { xpath: selector.replace(/^xpath=/i, "") };
  }
  // Only explicit XPath forms: a leading `/` or `//` (absolute/descendant path), a
  // leading `./` (relative path), or a `(` grouping expression. A bare leading `.`
  // is a CSS class selector (e.g. `.submit-button`) — NOT XPath — so it must fall
  // through to the CSS branch, otherwise replay does `page.locator("xpath=.submit-button")`
  // and never finds the element, failing valid recipes.
  if (/^[(/]|^\.\//.test(selector)) {
    return { xpath: selector };
  }

  // Otherwise CSS — keep the literal selector and recover any attributes we can,
  // so replay can fall back from a stale css path to a stable id/name/etc.
  const attributes = {
    id: match1(selector, /#([\w-]+)/) || match1(selector, /\[id=["']([^"']+)["']\]/),
    name: match1(selector, /\[name=["']([^"']+)["']\]/),
    ariaLabel: match1(selector, /\[aria-label=["']([^"']+)["']\]/i),
    placeholder: match1(selector, /\[placeholder=["']([^"']+)["']\]/i),
    type: match1(selector, /\[type=["']([^"']+)["']\]/i),
  };

  const out = { css: selector };
  // Only attach attributes we actually found (drop the all-null object otherwise).
  const present = Object.fromEntries(
    Object.entries(attributes).filter(([, v]) => v != null)
  );
  if (Object.keys(present).length) out.attributes = present;
  return out;
}

/** Whether a string looks like an absolute URL we can navigate to. */
function isUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

/**
 * Map one recordedAction to a recipe step (sans `order`), or null when it can't
 * form a deterministic, value-bearing step (e.g. a navigate with no URL, a click
 * with no selector, a fill with no resolvable value source).
 *
 * @param {Object} recorded - A state.recordedActions entry.
 * @returns {Object|null}
 */
function toRecipeStep(recorded) {
  if (!recorded || typeof recorded !== "object") return null;

  const verb = String(recorded.action || "").toLowerCase();
  const action = ACTION_ALIASES[verb];
  if (!action) return null;

  const description =
    recorded.description != null ? String(recorded.description).slice(0, 300) : null;

  if (action === "navigate") {
    const url = recorded.staticValue || recorded.url || recorded.value;
    if (!isUrl(url)) return null; // a navigate with no URL is not replayable
    return { action, staticValue: String(url).trim(), description };
  }

  const selector = toRecipeSelector(recorded.selector);

  if (action === "click") {
    if (!selector) return null; // nothing to click → drop
    return { action, selector, description };
  }

  if (action === "keypress") {
    const key = recorded.key || recorded.value || "Enter";
    return { action, ...(selector ? { selector } : {}), key: String(key), description };
  }

  if (action === "wait" || action === "waitForNavigation") {
    return { action, description };
  }

  if (DATA_STEP_ACTIONS.has(action)) {
    if (!selector) return null; // can't place a value with no target → drop
    // Value source: a known billing dataKey (preferred), else a literal value.
    const dataKey =
      recorded.dataKey && VALID_DATA_KEYS.has(recorded.dataKey)
        ? recorded.dataKey
        : null;
    const literal = !dataKey && recorded.value != null ? String(recorded.value) : null;
    if (!dataKey && literal == null) return null; // no value to write → drop
    return {
      action,
      selector,
      dataKey,
      staticValue: literal,
      description,
    };
  }

  return null;
}

/**
 * Build the ordered recipe steps from a run's recordedActions: map each action,
 * drop the unmappable ones, collapse consecutive duplicate navigates to the same
 * URL, and number the survivors 1-based.
 *
 * @param {Array<Object>} recordedActions
 * @returns {Array<Object>}
 */
function buildSteps(recordedActions) {
  const steps = [];
  let lastNavUrl = null;

  for (const recorded of recordedActions || []) {
    const step = toRecipeStep(recorded);
    if (!step) continue;

    // Skip a navigate that just repeats the previous navigate's URL.
    if (step.action === "navigate") {
      if (step.staticValue === lastNavUrl) continue;
      lastNavUrl = step.staticValue;
    } else {
      lastNavUrl = null;
    }

    steps.push({ ...step, order: steps.length + 1 });
  }

  return steps;
}

/** Map the run's fill method to the recipe's recordedVia ("ai" | "human"). */
function recordedViaFor(method) {
  return method === INVOICE_METHOD.HUMAN ? "human" : "ai";
}

/** Whether this run followed a failed recipe replay (drives the self-heal note). */
function followedFailedReplay(state) {
  return (state?.stages || []).some(
    (s) => s && s.stage === "replay_recipe" && s.ok === false
  );
}

/**
 * distill_recipe node — distill a successful ai/human fill into an active
 * MerchantRecipe so the next ticket for this RFC replays it deterministically.
 *
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function distillRecipe(state) {
  const base = { status: INVOICE_STATUS.DISTILLING };

  // Only an ai/human fill is worth distilling. (The shell already gates on this;
  // guard anyway so the node is correct if called directly.)
  if (state.method === INVOICE_METHOD.RECIPE) {
    return { ...base, detail: "skipped: run replayed an existing recipe" };
  }

  // Without an RFC there is no merchant key to file the recipe under.
  const rfcEmisor = (state.rfcEmisor || "").trim();
  if (!rfcEmisor) {
    log.warn("distill_recipe: no rfcEmisor — cannot key a recipe", {
      ticketId: state.ticketId,
    });
    return { ...base, detail: "skipped: no rfcEmisor to key the recipe" };
  }

  const steps = buildSteps(state.recordedActions);

  // A recipe with no value-bearing fill/select step would replay into an empty
  // form — worse than no recipe. Don't persist it.
  const hasDataStep = steps.some((s) => DATA_STEP_ACTIONS.has(s.action));
  if (!hasDataStep) {
    log.warn("distill_recipe: no replayable fill steps — nothing to distill", {
      ticketId: state.ticketId,
      rfcEmisor,
      recorded: (state.recordedActions || []).length,
      mappedSteps: steps.length,
    });
    return {
      ...base,
      detail: "skipped: recorded actions held no replayable fill steps",
    };
  }

  const recordedVia = recordedViaFor(state.method);
  const selfHeal = followedFailedReplay(state);

  try {
    await connectMongoose();
    const recipe = await MerchantRecipe.createNewVersion(rfcEmisor, steps, state.portalUrl, {
      merchantName: state.merchantName || null,
      normalizedName: normalizeName(state.merchantName),
      recordedVia,
    });

    log.info("distill_recipe: recipe distilled", {
      ticketId: state.ticketId,
      rfcEmisor,
      recipeId: String(recipe._id),
      version: recipe.version,
      steps: steps.length,
      recordedVia,
      selfHeal,
    });

    const dataSteps = steps.filter((s) => DATA_STEP_ACTIONS.has(s.action)).length;
    return {
      ...base,
      detail:
        `distilled recipe v${recipe.version} (${steps.length} step(s), ${dataSteps} field(s), via ${recordedVia})` +
        (selfHeal ? " — superseded the recipe that failed replay this run" : ""),
    };
  } catch (err) {
    // Best-effort: the form is already filled. A distillation failure must not fail
    // the run, so swallow it into a normal (ok) stage with an explanatory detail.
    log.error("distill_recipe: could not persist recipe", {
      ticketId: state.ticketId,
      rfcEmisor,
      error: String(err?.message || err),
    });
    return { ...base, detail: `distillation failed (non-fatal): ${err?.message || err}` };
  }
}

export default distillRecipe;
