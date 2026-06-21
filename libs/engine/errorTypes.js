// Engine contract — the closed set of error codes a node may raise.
//
// Every failure the engine produces is tagged with one of these codes (stored on
// InvoiceState.errorType and on the failing stages[] entry). The `humanResolvable`
// flag tells the orchestrator whether a person taking over the live browser
// session could plausibly fix it (captcha, login wall, a form we couldn't find or
// fill) versus a failure that a human at the keyboard cannot — a missing URL, a
// timeout, broken page, agent crash, missing company data.

/**
 * @typedef {Object} EngineError
 * @property {string} code - The error code; equals its key in ENGINE_ERRORS.
 * @property {boolean} humanResolvable - True if a human on the live session can resolve it.
 * @property {string} description - One-line explanation.
 */

const define = (code, humanResolvable, description) =>
  Object.freeze({ code, humanResolvable, description });

/**
 * ENGINE_ERRORS — code → descriptor. Reference codes as `ENGINE_ERRORS.X.code`
 * (which equals the key string `'X'`).
 *
 * @type {Readonly<Record<string, EngineError>>}
 */
export const ENGINE_ERRORS = Object.freeze({
  NO_URL: define(
    "NO_URL",
    false,
    "No portal URL could be resolved for the merchant."
  ),
  NAVIGATION_TIMEOUT: define(
    "NAVIGATION_TIMEOUT",
    false,
    "The portal did not load within the allotted time."
  ),
  PAGE_BROKEN: define(
    "PAGE_BROKEN",
    false,
    "The portal page errored or is unusable (5xx, blank, JS crash)."
  ),
  CAPTCHA_DETECTED: define(
    "CAPTCHA_DETECTED",
    true,
    "A captcha is blocking automated progress."
  ),
  LOGIN_REQUIRED: define(
    "LOGIN_REQUIRED",
    true,
    "The portal requires credentials we don't have."
  ),
  FORM_NOT_FOUND: define(
    "FORM_NOT_FOUND",
    true,
    "The invoicing form could not be located on the portal."
  ),
  AGENT_FAILED: define(
    "AGENT_FAILED",
    false,
    "The browsing agent crashed or returned an unusable result."
  ),
  MISSING_COMPANY_DATA: define(
    "MISSING_COMPANY_DATA",
    false,
    "Required billing data is missing from the user's company profile."
  ),
  FORM_FILL_FAILED: define(
    "FORM_FILL_FAILED",
    true,
    "The form was found but one or more fields could not be filled."
  ),
  FORM_REJECTED: define(
    "FORM_REJECTED",
    true,
    "The portal rejected the submitted data (validation error / error modal)."
  ),
  RECIPE_REPLAY_FAILED: define(
    "RECIPE_REPLAY_FAILED",
    false,
    "Replaying the stored recipe failed (portal likely changed)."
  ),
  UNKNOWN: define("UNKNOWN", false, "Unclassified failure."),
});

/** All valid error codes — handy as a mongoose `enum`. */
export const ENGINE_ERROR_CODES = Object.freeze(Object.keys(ENGINE_ERRORS));

/**
 * Whether an error code can plausibly be resolved by a human on the live session.
 * Accepts a code string or an EngineError descriptor. Unknown codes → false.
 *
 * @param {string|EngineError|null|undefined} errorType
 * @returns {boolean}
 */
export function isHumanResolvable(errorType) {
  if (!errorType) return false;
  const code = typeof errorType === "string" ? errorType : errorType.code;
  return Boolean(ENGINE_ERRORS[code]?.humanResolvable);
}
