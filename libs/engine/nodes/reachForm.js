// reach_form — get from the portal landing page to the actual fiscal invoice form.
//
// init_navigate leaves us on the merchant's facturación landing page; the fillable
// CFDI form is usually a few clicks away (a "Facturar" button, a folio/RFC lookup,
// a wizard, a modal, sometimes a brand-new tab). This node bridges that gap with a
// cheap→expensive cascade so the common cases never pay for AI:
//
//   Phase 1 — DOM blocker check (free). Read the live DOM and classify the page as
//     blocked: a captcha widget/keywords → CAPTCHA_DETECTED, a login wall (visible
//     password field + login intent) → LOGIN_REQUIRED, an error/blank page →
//     PAGE_BROKEN. Login is only a blocker when a password field is present — a
//     page that already shows invoice fields with no password is NOT a login wall.
//
//   Phase 2 — DOM form check (free). If the landing page already IS a fillable form
//     we're done: formReached, reached "direct", zero AI spend. "Fillable form" means
//     EITHER the fiscal form (≥2 inputs + a fiscal keyword + no password) OR the
//     ticket-lookup gate that precedes it on most MX portals (≥2 inputs + a lookup
//     keyword like folio/sucursal/punto de venta/total + no password). We stop on the
//     gate too — the data-aware fill step enters the real ticket values into it.
//
//   Phase 3 — AI navigation. A Stagehand operator agent (Sonnet plans, Haiku
//     executes) clicks through "Facturar/Generar factura" flows, wizards, modals
//     and new tabs to reach a form (maxSteps 10, 90s budget). It navigates by
//     CLICKING ONLY — it never types into fields (typing here copies the portal's
//     sample-ticket example; the real data is entered later by the fill step). It
//     emits a token (LOGIN_REQUIRED / CAPTCHA_DETECTED / PAGE_BROKEN) at a wall.
//
// Final verification is ALWAYS a DOM real-form check across EVERY open tab — the
// agent's word is never trusted on its own, and the form may have opened in a new
// tab. Each navigation the agent performs is recorded into state.recordedActions so
// distill_recipe can later compress the walk into a replayable recipe.
//
// Like fill_form / replay_recipe, this node reconnects to the keepAlive Browserbase
// session (it is not carried on state) and drops only its local handle when done —
// the cloud session stays alive for the fill step and any human takeover.

import { INVOICE_STATUS } from "@/libs/engine/state";
import { ENGINE_ERRORS } from "@/libs/engine/errorTypes";
import { engineError } from "@/libs/engine/node";
import { reconnectSession, getActivePage } from "@/libs/engine/session";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:reach-form" });

// Operator-agent models (Stagehand v3, AI SDK provider format). The planning model
// reasons about the next navigation step; the execution model drives the lower-level
// act/observe calls. ANTHROPIC_API_KEY is auto-loaded from the environment.
const REACH_PLANNING_MODEL = "anthropic/claude-sonnet-4-6";
const REACH_EXECUTION_MODEL = "anthropic/claude-haiku-4-5";

// Agent budget: enough hops to clear a wizard/modal, capped so a confused agent
// can't burn tokens or wall-clock indefinitely.
const AGENT_MAX_STEPS = 10;
const AGENT_TIMEOUT_MS = 90000;

// Fiscal-form signal: a real CFDI form mentions at least one of these (accent- and
// case-insensitive). Folio alone is weak, but combined with ≥2 inputs it holds.
const FISCAL_KEYWORDS = [
  "rfc",
  "razon social",
  "regimen fiscal",
  "uso de cfdi",
  "codigo postal",
  "folio",
];

// Ticket-lookup-gate signal: most MX portals don't show the fiscal form first — they
// gate it behind a lookup that asks for the purchase's identifying data (branch, POS,
// folio, total, date) to find the ticket. That gate IS a reachable, fillable form: we
// must STOP on it and let the (data-aware, deterministic) fill step enter the real
// ticket values — never let the navigation agent type into it, or it copies the
// sample-ticket EXAMPLE the portal renders as a guide.
const LOOKUP_KEYWORDS = [
  "folio",
  "punto de venta",
  "sucursal",
  "tienda",
  "ticket",
  "importe",
  "total de la compra",
  "total de compra",
  "total de su compra",
  "fecha de compra",
  "fecha de emision",
  "terminal",
  "caja",
  "transaccion",
];

// Captcha intent in page text (the widget check in analyzePage covers the markup).
const CAPTCHA_KEYWORDS = [
  "captcha",
  "recaptcha",
  "hcaptcha",
  "no soy un robot",
  "verifica que eres humano",
  "verificar que eres humano",
  "verify you are human",
  "i am not a robot",
];

// Login intent — only meaningful when a visible password field is also present.
const LOGIN_KEYWORDS = [
  "iniciar sesion",
  "inicia sesion",
  "iniciar session",
  "log in",
  "login",
  "sign in",
  "ingresa tu contrasena",
  "usuario y contrasena",
  "correo y contrasena",
  "acceso a tu cuenta",
];

// Server-error / unusable-page text. init_navigate already rejected HTTP >= 400, so
// this catches 200-but-broken pages: maintenance screens, JS crash overlays, etc.
const BROKEN_KEYWORDS = [
  "internal server error",
  "500 internal server",
  "502 bad gateway",
  "503 service unavailable",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "404 not found",
  "pagina no encontrada",
  "no se encontro la pagina",
  "error del servidor",
  "application error",
  "site can't be reached",
  "this page isn't working",
  "temporarily unavailable",
  "sitio en mantenimiento",
];

// The agent emits one of these bare tokens when it gives up at a wall.
const BLOCKER_TOKENS = [
  ENGINE_ERRORS.CAPTCHA_DETECTED.code,
  ENGINE_ERRORS.LOGIN_REQUIRED.code,
  ENGINE_ERRORS.PAGE_BROKEN.code,
];

// Instruction handed to the operator agent. It reaches the form and STOPS — it must
// never fill the fiscal fields or submit (a later node + a human own that).
const REACH_INSTRUCTION = [
  "You are on a Mexican merchant's online invoicing (facturación / CFDI) portal.",
  "Your ONLY goal is to REACH a data-entry form so a later step can fill it. The form",
  "is EITHER a ticket-lookup form (fields like Sucursal/Tienda, Folio, Punto de Venta,",
  "Fecha, Total/Importe) OR the fiscal form (RFC, razón social, régimen fiscal, uso de",
  "CFDI, código postal). Reaching EITHER one means you are done.",
  "Navigate ONLY by clicking — never by typing:",
  "- Accept or close cookie banners, pop-ups and modal dialogs.",
  "- Click buttons, links or tabs such as 'Facturar', 'Generar factura', 'Facturación',",
  "  'Solicitar factura' or 'Facturación electrónica'.",
  "- Follow links even when they open in a new browser tab.",
  "ABSOLUTE RULE: do NOT type into or fill ANY input field, and do NOT click a search/",
  "submit/'Facturar' button that would submit a form. The portal often shows a SAMPLE",
  "ticket as a guide — never copy its values. Entering data is a later step's job, with",
  "the user's real ticket data; if you type here you would enter the wrong (example)",
  "values.",
  "STOP as soon as a form with input fields (lookup OR fiscal) is visible. Do not fill",
  "or submit anything.",
  "If you cannot reach a form because the portal demands signing in, reply with the",
  "single token LOGIN_REQUIRED. If a captcha blocks you, reply CAPTCHA_DETECTED. If",
  "the page is broken or shows a server error, reply PAGE_BROKEN.",
].join("\n");

/** Lowercase + strip diacritics so keyword checks survive 'régimen' vs 'regimen'. */
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Whether the page text carries at least one fiscal-form keyword. */
function hasFiscalKeyword(text) {
  const haystack = normalizeText(text);
  return FISCAL_KEYWORDS.some((k) => haystack.includes(k));
}

/** Whether the page text carries at least one ticket-lookup-gate keyword. */
function hasLookupKeyword(text) {
  const haystack = normalizeText(text);
  return LOOKUP_KEYWORDS.some((k) => haystack.includes(k));
}

/** Best-effort current URL of a page (a closed/crashed page throws). */
function safeUrl(page) {
  try {
    return page.url() || null;
  } catch {
    return null;
  }
}

/** Let a just-attached page settle without blocking on a slow network. */
async function settle(page) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 });
  } catch {
    // Already loaded, or still loading — analyze whatever is there now.
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Analyze a page, but POLL until its form has rendered before giving a verdict.
 * Merchant portals are SPAs (Alsuper renders the fiscal form client-side after
 * load), so a single analyze at domcontentloaded races the render and can see
 * zero inputs — making a page that IS the form look empty. Re-analyze until the
 * page reads as a real form, reads as blocked, or the budget elapses; return the
 * last signals either way. Free (no AI) — just a few extra DOM reads.
 *
 * @param {import("playwright").Page} page
 * @param {{timeoutMs?: number, intervalMs?: number}} [opts]
 */
async function analyzePageReady(page, { timeoutMs = 9000, intervalMs = 600 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let signals = await analyzePage(page);
  while (
    Date.now() < deadline &&
    !isReachableForm(signals) &&
    !classifyBlocker(signals)
  ) {
    await sleep(intervalMs);
    signals = await analyzePage(page);
  }
  return signals;
}

/**
 * Read structured signals from the live DOM of one page. Runs entirely in the
 * browser (page.evaluate) so it is free and never touches the AI. Returns null when
 * the page can't be evaluated (closed/blank context).
 *
 * @param {import("playwright").Page} page
 * @returns {Promise<null | {
 *   textSnippet: string, title: string, visibleInputCount: number,
 *   hasPassword: boolean, hasCaptchaWidget: boolean, bodyTextLength: number,
 *   linkCount: number,
 * }>}
 */
async function analyzePage(page) {
  if (!page) return null;
  await settle(page);
  try {
    return await page.evaluate(() => {
      const isVisible = (el) => {
        try {
          const style = window.getComputedStyle(el);
          if (
            !style ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        } catch {
          return false;
        }
      };

      const controls = Array.from(
        document.querySelectorAll("input, select, textarea")
      ).filter(isVisible);

      const typeOf = (el) =>
        String(el.getAttribute("type") || "text").toLowerCase();

      const hasPassword = controls.some(
        (el) => el.tagName === "INPUT" && typeOf(el) === "password"
      );

      // Count only data-entry controls — ignore hidden/submit/button inputs.
      const fillable = controls.filter((el) => {
        if (el.tagName !== "INPUT") return true; // select / textarea
        return !["hidden", "submit", "button", "image", "reset"].includes(
          typeOf(el)
        );
      });

      let hasCaptchaWidget = false;
      try {
        hasCaptchaWidget = Boolean(
          document.querySelector(
            ".g-recaptcha, iframe[src*='recaptcha'], iframe[title*='captcha' i]," +
              ".h-captcha, iframe[src*='hcaptcha'], .cf-turnstile," +
              "iframe[src*='turnstile'], iframe[src*='challenges.cloudflare']," +
              "#px-captcha"
          )
        );
      } catch {
        hasCaptchaWidget = false;
      }

      const bodyText = (document.body && document.body.innerText) || "";

      return {
        textSnippet: bodyText.slice(0, 6000),
        title: document.title || "",
        visibleInputCount: fillable.length,
        hasPassword,
        hasCaptchaWidget,
        bodyTextLength: bodyText.trim().length,
        linkCount: document.querySelectorAll("a[href]").length,
      };
    });
  } catch (err) {
    log.warn("reach_form: page analysis failed", { error: String(err) });
    return null;
  }
}

/**
 * Classify a page's blocker from its DOM signals, or null when it isn't blocked.
 * Priority: captcha → login → broken (the most actionable signal wins).
 *
 * @param {ReturnType<typeof analyzePage> extends Promise<infer T> ? T : never} signals
 * @returns {string|null} An ENGINE_ERRORS code, or null.
 */
function classifyBlocker(signals) {
  if (!signals) return null;
  const haystack = normalizeText(`${signals.textSnippet} ${signals.title}`);

  // Captcha: an embedded widget, or unambiguous challenge text.
  if (signals.hasCaptchaWidget || CAPTCHA_KEYWORDS.some((k) => haystack.includes(k))) {
    return ENGINE_ERRORS.CAPTCHA_DETECTED.code;
  }

  // Login wall: a visible password field AND sign-in intent. Without a password
  // field it is not a blocker (login is optional when invoice fields are visible).
  if (signals.hasPassword && LOGIN_KEYWORDS.some((k) => haystack.includes(k))) {
    return ENGINE_ERRORS.LOGIN_REQUIRED.code;
  }

  // Broken: explicit error text, or an effectively empty page.
  if (BROKEN_KEYWORDS.some((k) => haystack.includes(k))) {
    return ENGINE_ERRORS.PAGE_BROKEN.code;
  }
  if (
    signals.visibleInputCount === 0 &&
    signals.linkCount === 0 &&
    signals.bodyTextLength < 20
  ) {
    return ENGINE_ERRORS.PAGE_BROKEN.code;
  }

  return null;
}

/**
 * Whether a page's DOM signals describe a real, fillable fiscal form: at least two
 * data-entry inputs, a fiscal keyword, and no password field (which would mark a
 * login wall instead).
 */
function isRealForm(signals) {
  if (!signals) return false;
  if (signals.hasPassword) return false;
  if (signals.visibleInputCount < 2) return false;
  return hasFiscalKeyword(signals.textSnippet);
}

/**
 * Whether a page's DOM signals describe a ticket-lookup gate: ≥2 data-entry inputs,
 * no password, and a lookup keyword (folio / sucursal / punto de venta / total …).
 * This is the data-entry screen that precedes the fiscal form on most MX portals.
 */
function isLookupGate(signals) {
  if (!signals) return false;
  if (signals.hasPassword) return false;
  if (signals.visibleInputCount < 2) return false;
  return hasLookupKeyword(signals.textSnippet);
}

/**
 * Whether a page is a reachable, fillable form the fill step can take over: either
 * the fiscal CFDI form OR the ticket-lookup gate in front of it. reach_form's job is
 * to land us on EITHER and then stop — the deterministic, data-aware fill step enters
 * the real values for whichever it is. (The navigation agent must NEVER type into
 * these; it would copy the sample-ticket example the portal shows.)
 */
function isReachableForm(signals) {
  return isRealForm(signals) || isLookupGate(signals);
}

/** Every open tab/page in the session, falling back to the single active page. */
function collectPages(stagehand) {
  let pages = [];
  try {
    pages = stagehand.context?.pages?.() || [];
  } catch {
    pages = [];
  }
  // Stagehand v3 has no stagehand.page; fall back to the context's active page.
  if (!pages.length) {
    const active = stagehand.context?.activePage?.();
    if (active) pages = [active];
  }
  return pages.filter(Boolean);
}

/**
 * Scan every tab for a real fiscal form. Returns the first matching page and its
 * signals, or null when none of the open tabs shows the form.
 */
async function findFormPage(pages) {
  for (const page of pages) {
    // Poll per tab — the form may still be rendering when the agent stops.
    const signals = await analyzePageReady(page);
    if (isReachableForm(signals)) return { page, signals };
  }
  return null;
}

/**
 * Scan every tab for a blocker and return the highest-priority code found
 * (captcha → login → broken), or null when nothing is blocked.
 */
async function findBlocker(pages) {
  const found = new Set();
  for (const page of pages) {
    const code = classifyBlocker(await analyzePage(page));
    if (code) found.add(code);
  }
  for (const code of [
    ENGINE_ERRORS.CAPTCHA_DETECTED.code,
    ENGINE_ERRORS.LOGIN_REQUIRED.code,
    ENGINE_ERRORS.PAGE_BROKEN.code,
  ]) {
    if (found.has(code)) return code;
  }
  return null;
}

/** Extract a blocker token the agent printed in its final message, or null. */
function tokenFromMessage(message) {
  const upper = String(message || "").toUpperCase();
  return BLOCKER_TOKENS.find((token) => upper.includes(token)) || null;
}

// Agent tools that only inspect the page (no navigation) — skipped when recording,
// so recordedActions stays a list of reproducible navigation/interaction steps.
const NON_NAV_AGENT_TOOLS = new Set([
  "observe",
  "extract",
  "ariatree",
  "aria_tree",
  "screenshot",
  "message",
  "reasoning",
]);

/**
 * Normalize the operator agent's reported actions (AgentAction[]) into
 * recordedActions entries for distillation. Defensive about shape — Stagehand's
 * action objects carry tool-specific fields — keeping the action kind plus any
 * selector / URL / instruction we can recover, and dropping pure-inspection tools.
 *
 * @param {Array<any>} actions
 * @returns {Array<{action:string, selector?:string, staticValue?:string, description?:string, source:string}>}
 */
function mapAgentActions(actions) {
  const out = [];
  for (const a of actions || []) {
    if (!a || typeof a !== "object") continue;
    const type = String(
      a.type || a.action || a.method || a.name || "action"
    ).toLowerCase();
    if (NON_NAV_AGENT_TOOLS.has(type)) continue;

    const args = a.arguments || a.playwrightArguments || a.params || {};
    const selector = a.selector || args.selector || null;
    const url = a.pageUrl || a.url || args.url || null;
    const description =
      a.instruction || a.description || a.text || a.label || a.reasoning || null;
    out.push({
      action: type,
      ...(selector ? { selector: String(selector) } : {}),
      ...(url ? { staticValue: String(url) } : {}),
      ...(description ? { description: String(description).slice(0, 300) } : {}),
      source: "reach",
    });
  }
  return out;
}

/**
 * Run the operator agent with a hard wall-clock cap. Resolves with the agent's
 * result, or { timedOut: true } when the budget is exceeded — we still verify the
 * DOM afterwards, since the agent may have reached the form before stalling.
 */
async function runAgentWithTimeout(stagehand) {
  const agent = stagehand.agent({
    model: REACH_PLANNING_MODEL,
    executionModel: REACH_EXECUTION_MODEL,
  });

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), AGENT_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      agent.execute({ instruction: REACH_INSTRUCTION, maxSteps: AGENT_MAX_STEPS }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * reach_form node — bridge the portal landing page to the fillable fiscal form.
 *
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function reachForm(state) {
  // Reconnect to the keepAlive session init_navigate opened. No session → there is
  // no browser to drive: an infrastructure failure (let the shell retry), not a
  // human-resolvable one.
  const sessionRef = state.browserbaseSessionId || state.connectUrl;
  if (!sessionRef) {
    throw engineError(
      "No browser session to reach the form (browserbaseSessionId missing)",
      ENGINE_ERRORS.AGENT_FAILED.code
    );
  }

  let stagehand;
  try {
    ({ stagehand } = await reconnectSession(sessionRef));
  } catch (err) {
    throw engineError(
      `Could not reconnect to the browser session: ${err?.message || err}`,
      ENGINE_ERRORS.AGENT_FAILED.code
    );
  }

  const recordedActions = [...(state.recordedActions || [])];

  try {
    // Stagehand v3 has no stagehand.page — resolve the live page off the context.
    const page = getActivePage(stagehand);
    // Poll for the form to render (SPA portals lazy-render it) before judging the
    // landing page — a single read can race the render and miss a form that's there.
    const landingSignals = await analyzePageReady(page);

    // Phase 1 — DOM blocker check (free). A blocked landing page fails fast with a
    // classified, correctly human-resolvable error; no point spending AI on it.
    const landingBlocker = classifyBlocker(landingSignals);
    // A page that already IS the fillable form must not be declared blocked by a mere
    // TEXT mention of a blocker keyword (e.g. form copy "si aparece un captcha,
    // resuélvelo", or stray error/404 wording). Only a real captcha WIDGET genuinely
    // blocks a form that's right there; otherwise defer to the Phase 2 real-form check.
    const formDespiteText =
      isReachableForm(landingSignals) && !landingSignals?.hasCaptchaWidget;
    if (landingBlocker && !formDespiteText) {
      throw engineError(
        `Portal blocked before the form (${landingBlocker})`,
        landingBlocker
      );
    }

    // Phase 2 — DOM form check (free). The landing page already IS a fillable form
    // (the fiscal form, or the ticket-lookup gate in front of it). Stop here and let
    // the data-aware fill step enter the real values.
    if (isReachableForm(landingSignals)) {
      const kind = isRealForm(landingSignals) ? "fiscal form" : "ticket-lookup form";
      log.info("reach_form: form reached directly", {
        ticketId: state.ticketId,
        kind,
      });
      return {
        status: INVOICE_STATUS.REACHING_FORM,
        formReached: true,
        detail: `reached the ${kind} directly — ${safeUrl(page) || "form visible"}`,
      };
    }

    // Phase 3 — AI navigation. Let the operator agent click through to the form.
    const result = await runAgentWithTimeout(stagehand);
    const timedOut = Boolean(result && result.timedOut);
    const agentMessage = timedOut ? null : result?.message ?? null;
    const agentActions = timedOut || !Array.isArray(result?.actions)
      ? []
      : result.actions;

    // Final verification — ALWAYS a DOM real-form check across every open tab; the
    // agent may have opened the form in a new tab, and its word alone isn't trusted.
    const pages = collectPages(stagehand);
    const hit = await findFormPage(pages);

    if (hit) {
      // Surface the form's tab so the fill node lands on it. The fill node drives
      // Stagehand's ACTIVE page (its AI methods take no explicit page), so mark the
      // form tab active — not just bringToFront() — or a multi-tab navigation would
      // leave the original landing tab active and the fill would run on the wrong page.
      try {
        await hit.page.bringToFront();
      } catch {
        // Non-fatal — the fill node reconnects and re-finds the page if needed.
      }
      try {
        stagehand.context?.setActivePage?.(hit.page);
      } catch {
        // Non-fatal — activePage() falls back to the most-recent page.
      }

      const formUrl = safeUrl(hit.page);
      recordedActions.push(...mapAgentActions(agentActions));
      if (formUrl) {
        recordedActions.push({
          action: "navigate",
          staticValue: formUrl,
          source: "reach",
          description: "invoicing form reached",
        });
      }

      log.info("reach_form: form reached via agent", {
        ticketId: state.ticketId,
        timedOut,
        recorded: recordedActions.length,
      });
      return {
        status: INVOICE_STATUS.REACHING_FORM,
        formReached: true,
        recordedActions,
        detail: `reached the invoicing form via AI navigation${
          timedOut ? " (after the step budget elapsed)" : ""
        } — ${formUrl || "form visible"}`,
      };
    }

    // No form anywhere. Prefer hard DOM evidence of a blocker (most actionable),
    // then the agent's own token, then a classified failure.
    const domBlocker = await findBlocker(pages);
    if (domBlocker) {
      throw engineError(
        `Reached a wall before the form (${domBlocker})`,
        domBlocker
      );
    }
    const tokenBlocker = tokenFromMessage(agentMessage);
    if (tokenBlocker) {
      throw engineError(
        `Agent reported it was blocked (${tokenBlocker})`,
        tokenBlocker
      );
    }
    if (timedOut) {
      throw engineError(
        `Agent did not reach the form within ${AGENT_TIMEOUT_MS}ms`,
        ENGINE_ERRORS.FORM_NOT_FOUND.code
      );
    }
    throw engineError(
      "Could not locate the invoicing form on the portal",
      ENGINE_ERRORS.FORM_NOT_FOUND.code
    );
  } finally {
    // Drop our local CDP/SDK handle only. keepAlive keeps the cloud session
    // running for the fill step and any human takeover — never release it here.
    try {
      await stagehand.close();
    } catch (err) {
      log.warn("reach_form: stagehand close failed", {
        ticketId: state.ticketId,
        error: String(err),
      });
    }
  }
}

export default reachForm;
