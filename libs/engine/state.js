// Engine contract — the shared state shape every invoicing node reads and writes.
//
// The invoicing engine drives a cloud browser (Browserbase) through a merchant's
// CFDI portal to emit an invoice. Nodes are tightly coupled: they share one
// InvoiceState object, one browser session, and one recipe shape. This file is
// the single source of truth for that state so nodes can be built in parallel
// without integration drift.
//
// Nodes never mutate state in place. A node returns ONLY the fields it changed
// (a Partial<InvoiceState>); the orchestrator merges that partial into state and
// persists it onto Ticket.invoice, which the dashboard polls. See node.js for
// the node signature and the runNode() helper.

/**
 * INVOICE_STATUS — the lifecycle of a single invoice run.
 *
 * Flow (happy path): queued → resolving_portal → navigating → reaching_form →
 * (replaying | ai_filling) → ready_to_submit → done. A run that needs a person
 * parks at awaiting_human; distilling turns a successful ai/human fill into a
 * reusable recipe; failed is terminal on an unrecoverable error.
 *
 * Persisted on Ticket.invoice.status.
 */
export const INVOICE_STATUS = Object.freeze({
  QUEUED: "queued",
  RESOLVING_PORTAL: "resolving_portal",
  NAVIGATING: "navigating",
  REACHING_FORM: "reaching_form",
  REPLAYING: "replaying",
  AI_FILLING: "ai_filling",
  AWAITING_HUMAN: "awaiting_human",
  DISTILLING: "distilling",
  READY_TO_SUBMIT: "ready_to_submit",
  DONE: "done",
  // The CFDI was delivered to our catch-all inbox by the merchant portal and the
  // XML/PDF is now stored in R2 (see libs/engine/invoiceMailbox.js). Set by the
  // inbound email webhook, independent of the engine run's own progress.
  DELIVERED: "delivered",
  FAILED: "failed",
});

/** All INVOICE_STATUS string values — handy as a mongoose `enum`. */
export const INVOICE_STATUS_VALUES = Object.freeze(Object.values(INVOICE_STATUS));

/**
 * INVOICE_METHOD — how the form ultimately got filled.
 *  - recipe: replayed a previously distilled recipe (cheapest, fastest).
 *  - ai: a browsing agent filled it from scratch.
 *  - human: a person took over via the live session.
 *
 * Persisted on Ticket.invoice.method.
 */
export const INVOICE_METHOD = Object.freeze({
  RECIPE: "recipe",
  AI: "ai",
  HUMAN: "human",
});

/** All INVOICE_METHOD string values — handy as a mongoose `enum`. */
export const INVOICE_METHOD_VALUES = Object.freeze(Object.values(INVOICE_METHOD));

/**
 * @typedef {Object} Stage
 * One recorded step of the run. runNode() appends exactly one Stage per node,
 * so stages[] is the run's ordered audit trail (also surfaced in the dashboard).
 * @property {string} stage - Node/step name, usually an INVOICE_STATUS value.
 * @property {boolean} ok - Whether the node completed without throwing.
 * @property {string|null} detail - Human-readable note, or the error message when ok===false.
 * @property {string|null} errorType - One of ENGINE_ERRORS codes when ok===false, else null.
 * @property {string} at - ISO 8601 timestamp of when the stage finished.
 */

/**
 * @typedef {Object} RecordedAction
 * A single browser interaction captured while filling (ai/human). The ordered
 * list of RecordedActions is what the distilling step turns into a Recipe.
 * @property {string} type - Action kind, e.g. 'navigate' | 'click' | 'type' | 'select'.
 * @property {string} [selector] - Target element selector, when applicable.
 * @property {string} [value] - Value typed/selected, when applicable.
 * @property {string} [field] - Logical field this action fills (e.g. 'rfc', 'email').
 * @property {string} [at] - ISO 8601 timestamp.
 */

/**
 * @typedef {Object} FilledField
 * A form field the engine successfully filled.
 * @property {string} field - Logical field name (e.g. 'rfc', 'razonSocial', 'email').
 * @property {string} [selector] - Selector used to fill it.
 * @property {string} [value] - Value written.
 */

/**
 * @typedef {Object} UnfilledField
 * A form field the engine could NOT fill — needs AI or a human to resolve.
 * @property {string} field - Logical field name.
 * @property {string} [selector] - Selector that was targeted, if known.
 * @property {string} [reason] - Why it could not be filled (missing data, unknown control, ...).
 */

/**
 * @typedef {Object} Screenshot
 * A screenshot captured during the run, stored in R2.
 * @property {string} key - R2 object key.
 * @property {string} [label] - What the shot shows (e.g. 'form', 'error', 'confirmation').
 * @property {string} [at] - ISO 8601 timestamp.
 */

/**
 * @typedef {Object} Recipe
 * The distilled, replayable plan for one merchant portal. Produced by the
 * distilling step from a successful run's recordedActions and replayed on
 * future runs for the same merchant. (Persisted by a later issue; documented
 * here so the engine contract is complete.)
 * @property {string} recipeId - Stable id for this recipe.
 * @property {number} version - Recipe version; bumped when re-distilled.
 * @property {string} rfcEmisor - Merchant RFC this recipe belongs to.
 * @property {string} portalUrl - Portal URL the recipe targets.
 * @property {RecordedAction[]} actions - Ordered actions to replay.
 * @property {string} [submitButtonSelector] - Selector of the final submit control.
 */

/**
 * @typedef {Object} InvoiceState
 * The full engine state for one invoice run. Nodes read this and return a
 * Partial<InvoiceState>. The whole object is persisted on Ticket.invoice.
 *
 * @property {string} status - Current lifecycle state; one of INVOICE_STATUS. Polled by the dashboard.
 * @property {string} ticketId - Ticket being invoiced (Ticket _id).
 * @property {string} userId - Owner of the ticket (User _id).
 * @property {string} merchantName - Display name of the merchant.
 * @property {string} rfcEmisor - Merchant RFC — the deterministic merchant key.
 * @property {string} portalUrl - Resolved CFDI portal URL to drive.
 * @property {string} urlSource - How portalUrl was obtained: 'cache' (KnownMerchant registry hit) | 'research' (Firecrawl discovery).
 * @property {string} browserbaseSessionId - Browserbase session id for this run.
 * @property {string} connectUrl - Live connect URL for human takeover / inspection.
 * @property {string} liveViewUrl - Embeddable, interactive live-view page (http) the human drives during an awaiting_human handoff (Browserbase debuggerFullscreenUrl).
 * @property {string} waitpointTokenId - Trigger.dev waitpoint token the run is suspended on while awaiting_human; the resume route completes it to continue.
 * @property {string} recipeId - Id of the recipe used to drive this run, if any.
 * @property {boolean} recipeFound - Whether resolve_portal/replay found an active recipe for the RFC.
 * @property {boolean} recipeUsed - Whether a recipe was replayed.
 * @property {number} recipeVersion - Version of the recipe used.
 * @property {('recipe'|'ai'|'human')} method - How the form was ultimately filled.
 * @property {boolean} formReached - Whether the invoicing form was reached.
 * @property {RecordedAction[]} recordedActions - Actions captured for recipe distillation.
 * @property {FilledField[]} filledFields - Fields filled successfully.
 * @property {UnfilledField[]} unfilledFields - Fields left unfilled (need AI/human).
 * @property {string} submitButtonSelector - Selector of the final submit control.
 * @property {Stage[]} stages - Ordered audit trail; one entry per node (see runNode).
 * @property {number} cost - Accumulated run cost in USD.
 * @property {Screenshot[]} screenshots - Screenshots captured during the run.
 * @property {string|null} error - Last error message, or null.
 * @property {string|null} errorType - Last error code (one of ENGINE_ERRORS), or null.
 */

export {};
