// replay_recipe — fill the invoicing form by deterministically replaying a
// distilled recipe. ZERO AI: the cheap/fast path, taken when a merchant already
// has an active recipe for its rfcEmisor.
//
// Flow:
//   1. MerchantRecipe.findActiveByRfc(rfcEmisor). No active recipe → return
//      { recipeFound: false } so the shell routes to the AI fill path. (This is
//      a hand-off, not a failure — nothing is recorded against any recipe.)
//   2. Assemble billingData (#56) — the values to write, keyed by recipe dataKey.
//      Throws MISSING_COMPANY_DATA when the user has no fiscal profile; that is a
//      data failure AI can't fix either, so it propagates unchanged.
//   3. Reconnect to the live keepAlive browser session that init_navigate /
//      reach_form left sitting on the form, and execute the recipe steps in order.
//
// Per step:
//   - Data steps (fill/select): resolve the target with resolveSelector()'s 7
//     strategies (css → id → name → ariaLabel → placeholder → xpath → text, first
//     visible wins), clear + type the value, then verify by reading it back
//     (retrying with real keystrokes via pressSequentially). Filled/unfilled
//     fields are tracked; a value that was present but could not be placed or
//     verified is treated as recipe drift.
//   - Structural steps (navigate/click/wait/waitForNavigation/keypress): a failure
//     means the portal no longer matches the recipe → abort immediately.
//
// Outcome:
//   - All structural steps ran and every value-bearing field verified →
//     recordSuccess() and report a recipe-method fill.
//   - A structural step failed, or a value-bearing field drifted → recordFailure()
//     and throw RECIPE_REPLAY_FAILED so the shell falls back to an AI fill.
//
// NOTE: the node reconnects to the session via state.browserbaseSessionId — the
// sanctioned way for a later node to pick the run back up (see libs/engine/session.js).
// How the live session is shared across nodes is finalized in the integration wave.

import connectMongoose from "@/libs/core/mongoose";
import MerchantRecipe from "@/models/MerchantRecipe";
import { INVOICE_STATUS, INVOICE_METHOD } from "@/libs/engine/state";
import { ENGINE_ERRORS } from "@/libs/engine/errorTypes";
import { engineError } from "@/libs/engine/node";
import { assembleBillingData, getBillingValue } from "@/libs/engine/billingData";
import { reconnectSession } from "@/libs/engine/session";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:replay-recipe" });

// Actions that write a billing value into the form; everything else is structural
// (navigation, clicks, waits) whose failure aborts the replay.
const DATA_ACTIONS = new Set(["fill", "select"]);

// Timeouts (ms) for the browser operations a replay performs. Kept short: a recipe
// runs against an already-loaded form, so a slow element usually means drift.
const NAV_TIMEOUT_MS = 30000;
const CLICK_TIMEOUT_MS = 10000;
const WAIT_FOR_SELECTOR_MS = 10000;
const DEFAULT_WAIT_MS = 500;
// Per-keystroke delay for the readback retry — slow enough for inputs with masks
// or JS handlers that drop a programmatic .fill().
const KEYSTROKE_DELAY_MS = 25;

/**
 * Resolve a recipe selector to a live, visible element using 7 strategies in a
 * fixed order: css → id → name → ariaLabel → placeholder → xpath → text. The
 * first strategy whose locator points at a visible element wins. Returns a
 * Playwright Locator, or null when nothing matches.
 *
 * @param {import("playwright").Page} page - The live page (stagehand.page).
 * @param {Object} selector - A MerchantRecipe step selector (css/xpath/text/attributes).
 * @returns {Promise<import("playwright").Locator|null>}
 */
export async function resolveSelector(page, selector) {
  if (!page || !selector) return null;
  const attrs = selector.attributes || {};

  // Strategy order is the contract; each entry is a thunk so a malformed selector
  // for one strategy can't break the others.
  const strategies = [
    selector.css ? () => page.locator(selector.css) : null,
    attrs.id ? () => page.locator(`[id="${attrs.id}"]`) : null,
    attrs.name ? () => page.locator(`[name="${attrs.name}"]`) : null,
    attrs.ariaLabel ? () => page.locator(`[aria-label="${attrs.ariaLabel}"]`) : null,
    attrs.placeholder ? () => page.locator(`[placeholder="${attrs.placeholder}"]`) : null,
    selector.xpath ? () => page.locator(`xpath=${selector.xpath}`) : null,
    selector.text ? () => page.getByText(selector.text) : null,
  ].filter(Boolean);

  for (const make of strategies) {
    try {
      const locator = make().first();
      if (await locator.isVisible()) return locator;
    } catch {
      // Malformed selector for this strategy — fall through to the next one.
    }
  }
  return null;
}

/** A short, human-readable string form of a recipe selector for the audit trail. */
function describeSelector(selector) {
  if (!selector) return null;
  const a = selector.attributes || {};
  return (
    selector.css ||
    (a.id ? `#${a.id}` : null) ||
    (a.name ? `[name="${a.name}"]` : null) ||
    (a.ariaLabel ? `[aria-label="${a.ariaLabel}"]` : null) ||
    (a.placeholder ? `[placeholder="${a.placeholder}"]` : null) ||
    (selector.xpath ? `xpath=${selector.xpath}` : null) ||
    (selector.text ? `text=${selector.text}` : null) ||
    null
  );
}

/** Read an element's current value, returning null if it isn't readable. */
async function readback(locator) {
  try {
    return await locator.inputValue();
  } catch {
    return null;
  }
}

/**
 * Clear the field, type the value, and verify by reading it back. Retries once
 * with real keystrokes (pressSequentially) for inputs that ignore a programmatic
 * fill. Returns true only when the readback matches.
 */
async function fillAndVerify(locator, value) {
  const want = String(value);

  // 1) Fast path: clear + fill, then confirm the value stuck.
  try {
    await locator.fill("");
    await locator.fill(want);
    if ((await readback(locator)) === want) return true;
  } catch {
    // fall through to the keystroke retry
  }

  // 2) Retry with real keystrokes — survives masks / JS input handlers.
  try {
    await locator.fill("");
    await locator.pressSequentially(want, { delay: KEYSTROKE_DELAY_MS });
    if ((await readback(locator)) === want) return true;
  } catch {
    // give up — the caller records the field as unfilled (recipe drift)
  }

  return false;
}

/** Choose a <select> option by value, then by label, verifying the readback. */
async function selectAndVerify(locator, value) {
  const want = String(value);
  for (const arg of [want, { label: want }]) {
    try {
      await locator.selectOption(arg);
      if ((await readback(locator)) === want) return true;
    } catch {
      // try the next matching mode
    }
  }
  return false;
}

/** Apply a structural step's post-conditions (fatal when they fail). */
async function applyWaits(page, step) {
  if (step.waitForSelector) {
    await page.waitForSelector(step.waitForSelector, { timeout: WAIT_FOR_SELECTOR_MS });
  }
  if (step.waitAfterMs) {
    await page.waitForTimeout(step.waitAfterMs);
  }
}

/**
 * Execute one structural (non-data) step. Throws on failure so the caller can
 * abort the replay and fall back to AI.
 */
async function executeStructural(page, step) {
  switch (step.action) {
    case "navigate": {
      if (!step.staticValue) throw new Error("navigate step has no URL");
      await page.goto(step.staticValue, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      break;
    }
    case "click": {
      const locator = await resolveSelector(page, step.selector);
      if (!locator) throw new Error("click target not found");
      await locator.click({ timeout: CLICK_TIMEOUT_MS });
      break;
    }
    case "waitForNavigation": {
      await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT_MS });
      break;
    }
    case "wait": {
      // Honor an explicit wait; otherwise pause briefly so the next step settles.
      if (!step.waitForSelector && !step.waitAfterMs) {
        await page.waitForTimeout(DEFAULT_WAIT_MS);
      }
      break;
    }
    case "keypress": {
      const key = step.key || "Enter";
      const locator = step.selector ? await resolveSelector(page, step.selector) : null;
      if (locator) await locator.press(key);
      else await page.keyboard.press(key);
      break;
    }
    default:
      throw new Error(`unsupported step action: ${step.action}`);
  }

  await applyWaits(page, step);
}

/**
 * Replay the ordered recipe steps against the live form.
 *
 * @returns {Promise<{
 *   filledFields: Array<{field:string, selector:string|null, value:string}>,
 *   unfilledFields: Array<{field:string, selector:string|null, reason:string}>,
 *   drifted: boolean,                       // a value-bearing field couldn't be placed/verified
 *   aborted: { action: string, reason: string }|null  // a structural step failed
 * }>}
 */
async function replaySteps(page, steps, billingData) {
  const filledFields = [];
  const unfilledFields = [];
  let drifted = false;

  const ordered = [...(steps || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  for (const step of ordered) {
    if (!DATA_ACTIONS.has(step.action)) {
      // Structural step — any failure means the portal drifted from the recipe.
      try {
        await executeStructural(page, step);
      } catch (err) {
        return {
          filledFields,
          unfilledFields,
          drifted,
          aborted: { action: step.action, reason: String(err?.message || err) },
        };
      }
      continue;
    }

    // Data step (fill/select): pull its value from billingData or a staticValue.
    const field = step.dataKey || step.description || "field";
    const sel = describeSelector(step.selector);
    const value = step.dataKey
      ? getBillingValue(billingData, step.dataKey)
      : step.staticValue;

    // No value to write: a data gap (e.g. receipt didn't carry it), not a recipe
    // defect — AI couldn't fill it either. Track it, don't mark drift.
    if (value === null || value === undefined || value === "") {
      unfilledFields.push({ field, selector: sel, reason: "no billing value" });
      continue;
    }

    const locator = await resolveSelector(page, step.selector);
    if (!locator) {
      unfilledFields.push({ field, selector: sel, reason: "selector not found" });
      drifted = true;
      continue;
    }

    const ok =
      step.action === "select"
        ? await selectAndVerify(locator, value)
        : await fillAndVerify(locator, value);

    if (ok) {
      filledFields.push({ field, selector: sel, value: String(value) });
    } else {
      unfilledFields.push({ field, selector: sel, reason: "value did not verify" });
      drifted = true;
    }
  }

  return { filledFields, unfilledFields, drifted, aborted: null };
}

/**
 * replay_recipe node — deterministically replay a merchant's distilled recipe.
 *
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string, recipeFound?: boolean }>}
 */
export async function replayRecipe(state) {
  await connectMongoose();

  const recipe = await MerchantRecipe.findActiveByRfc(state.rfcEmisor);
  if (!recipe) {
    // No deterministic playbook for this merchant — hand off to the AI fill path.
    return {
      recipeFound: false,
      recipeUsed: false,
      detail: `no active recipe for ${state.rfcEmisor || "unknown RFC"} — routing to AI`,
    };
  }

  // Values to write (#56). MISSING_COMPANY_DATA propagates: AI can't fix it either.
  const billingData = await assembleBillingData(state.ticketId, state.userId);

  // Drive the live session reach_form left on the form. A missing session is an
  // upstream/infra problem, not a recipe defect, so we don't penalize the recipe's
  // health — we just signal RECIPE_REPLAY_FAILED so the shell can fall back.
  if (!state.browserbaseSessionId) {
    throw engineError(
      "No live browser session to replay the recipe against",
      ENGINE_ERRORS.RECIPE_REPLAY_FAILED.code
    );
  }

  const { stagehand } = await reconnectSession(state.browserbaseSessionId);
  const page = stagehand.page;

  let result;
  try {
    result = await replaySteps(page, recipe.steps, billingData);
  } catch (err) {
    // An unexpected crash mid-replay — treat as drift and fall back to AI.
    await MerchantRecipe.recordFailure(recipe._id, String(err?.message || err));
    throw engineError(
      `Recipe replay crashed: ${err?.message || err}`,
      ENGINE_ERRORS.RECIPE_REPLAY_FAILED.code
    );
  }

  const recipeId = String(recipe._id);
  const recipeVersion = recipe.version;

  // A structural step failed → the portal no longer matches the recipe.
  if (result.aborted) {
    const reason = `aborted at ${result.aborted.action} step: ${result.aborted.reason}`;
    await MerchantRecipe.recordFailure(recipe._id, reason);
    log.warn("Recipe replay aborted", { ticketId: state.ticketId, recipeId, reason });
    throw engineError(reason, ENGINE_ERRORS.RECIPE_REPLAY_FAILED.code);
  }

  // A field that had a value could not be placed/verified → recipe drift.
  if (result.drifted) {
    const reason = `could not fill ${result.unfilledFields.length} field(s); portal likely changed`;
    await MerchantRecipe.recordFailure(recipe._id, reason);
    log.warn("Recipe replay incomplete", { ticketId: state.ticketId, recipeId, reason });
    throw engineError(reason, ENGINE_ERRORS.RECIPE_REPLAY_FAILED.code);
  }

  // Every structural step ran and every value-bearing field verified.
  await MerchantRecipe.recordSuccess(recipe._id);
  log.info("Recipe replayed", {
    ticketId: state.ticketId,
    recipeId,
    recipeVersion,
    filled: result.filledFields.length,
    unfilled: result.unfilledFields.length,
  });

  return {
    status: INVOICE_STATUS.REPLAYING,
    method: INVOICE_METHOD.RECIPE,
    recipeFound: true,
    recipeUsed: true,
    recipeId,
    recipeVersion,
    filledFields: result.filledFields,
    unfilledFields: result.unfilledFields,
    detail: `replayed recipe v${recipeVersion}: filled ${result.filledFields.length} field(s)`,
  };
}

export default replayRecipe;
