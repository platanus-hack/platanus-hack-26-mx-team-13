// Engine contract — the node signature and the runNode() wrapper.
//
// An engine node is a small async function that does one unit of work against
// the shared InvoiceState:
//
//   async (state) => Partial<InvoiceState>
//
// Contract:
//  - A node receives the current InvoiceState (read-only — never mutate it).
//  - A node returns ONLY the fields it changed (a Partial<InvoiceState>). The
//    orchestrator shallow-merges that partial into state and persists it.
//  - A node signals a typed failure by throwing — ideally an Error created with
//    engineError() so it carries an ENGINE_ERRORS code. runNode() records the
//    failure as a stages[] entry and surfaces error/errorType.
//  - A node may include a transient `detail` string in its return value: it is
//    copied onto the auto-appended stages[] entry and is NOT written to state.

import { ENGINE_ERRORS } from "./errorTypes.js";

/**
 * @typedef {import("./state.js").InvoiceState} InvoiceState
 * @typedef {import("./state.js").Stage} Stage
 */

/**
 * An engine node.
 * @callback EngineNode
 * @param {InvoiceState} state - Current state (treat as read-only).
 * @returns {Promise<Partial<InvoiceState> & { detail?: string }>}
 */

/**
 * Create an Error tagged with an ENGINE_ERRORS code, so a throwing node tells
 * runNode() exactly how to classify the failure.
 *
 * @param {string} message - Human-readable message (becomes the stage detail).
 * @param {string} [errorType] - An ENGINE_ERRORS code; defaults to UNKNOWN.
 * @returns {Error & { errorType: string }}
 *
 * @example
 * throw engineError("Portal never loaded", ENGINE_ERRORS.NAVIGATION_TIMEOUT.code);
 */
export function engineError(message, errorType = ENGINE_ERRORS.UNKNOWN.code) {
  const code = typeof errorType === "string" ? errorType : errorType?.code;
  const err = new Error(message);
  err.errorType = ENGINE_ERRORS[code] ? code : ENGINE_ERRORS.UNKNOWN.code;
  return err;
}

/**
 * Run an engine node and automatically append a Stage describing the outcome.
 *
 * On success: returns the node's partial (minus the transient `detail`) plus a
 * `stages` array = previous stages + a new ok:true entry.
 * On throw: swallows the error and returns `{ error, errorType, stages }` where
 * stages gains an ok:false entry carrying the error's code (UNKNOWN if untagged).
 *
 * The returned `stages` is the FULL new array, so a shallow merge into state
 * correctly replaces it. runNode never mutates `state`.
 *
 * @param {string} name - Stage name (typically an INVOICE_STATUS value).
 * @param {EngineNode} fn - The node to run.
 * @param {InvoiceState} state - Current state.
 * @returns {Promise<Partial<InvoiceState>>}
 */
export async function runNode(name, fn, state) {
  const at = new Date().toISOString();
  const previous = (state && state.stages) || [];

  try {
    const result = (await fn(state)) || {};
    const { detail = null, ...partial } = result;
    /** @type {Stage} */
    const stage = { stage: name, ok: true, detail, errorType: null, at };
    return { ...partial, stages: [...previous, stage] };
  } catch (err) {
    const code =
      err && err.errorType && ENGINE_ERRORS[err.errorType]
        ? err.errorType
        : ENGINE_ERRORS.UNKNOWN.code;
    const detail = err && err.message ? String(err.message) : String(err);
    /** @type {Stage} */
    const stage = { stage: name, ok: false, detail, errorType: code, at };
    return { error: detail, errorType: code, stages: [...previous, stage] };
  }
}
