// ready_to_submit — the form is filled and the run is parked for submission.
//
// Terminal state of this pipeline: the form is complete and the submit control
// located, but the engine does not click submit here — final submission (and the
// move to `done`) is a later, human-confirmed step. This node only verifies that
// a submit control was actually identified upstream; it never fabricates one.
//
// A run that reaches here WITHOUT a verified submitButtonSelector cannot honestly
// claim it's ready to submit — we don't know which control sends the form. Rather
// than inventing a placeholder selector (e.g. "#submit") and marking the run
// ready on a guess, park it at awaiting_human so a person can locate and confirm
// the submit control in the live session. Two exceptions skip that handoff:
//   - human fill (method === human): the person already worked the form live.
//   - recipe replay (method === recipe) that actually filled fields: replay_recipe
//     throws RECIPE_REPLAY_FAILED on drift/empty, so reaching here means the
//     deterministic fill landed. A recipe distilled before submitButtonSelector
//     existed shouldn't bounce a fully-filled form into a needless 10-min handoff;
//     final submit is human-confirmed downstream regardless.

import { INVOICE_STATUS, INVOICE_METHOD } from "@/libs/engine/state";

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function readyToSubmit(state) {
  // A verified submit control means the form is genuinely ready to submit.
  if (state.submitButtonSelector) {
    return {
      status: INVOICE_STATUS.READY_TO_SUBMIT,
      detail: "form ready; submit control located",
    };
  }

  // A human filled the form in the live session — trust they left it submit-ready
  // rather than fabricating a selector or handing off again.
  if (state.method === INVOICE_METHOD.HUMAN) {
    return {
      status: INVOICE_STATUS.READY_TO_SUBMIT,
      detail: "form ready (human-resolved fill); awaiting submit confirmation",
    };
  }

  // A deterministic recipe replay that actually filled fields. replay_recipe throws
  // RECIPE_REPLAY_FAILED on drift/empty, so reaching here means the fill landed; a
  // recipe distilled before submitButtonSelector existed shouldn't bounce a fully
  // filled form into a needless handoff. Final submit is human-confirmed downstream.
  if (state.method === INVOICE_METHOD.RECIPE && state.filledFields?.length) {
    return {
      status: INVOICE_STATUS.READY_TO_SUBMIT,
      detail: "form ready (recipe replay); submit control not captured in recipe",
    };
  }

  // No verified submit control on an automated fill: don't invent one. Park for a
  // human to locate and confirm the submit control in the live session.
  return {
    status: INVOICE_STATUS.AWAITING_HUMAN,
    detail: "submit control not found — needs a human to locate and confirm submit",
  };
}

export default readyToSubmit;
