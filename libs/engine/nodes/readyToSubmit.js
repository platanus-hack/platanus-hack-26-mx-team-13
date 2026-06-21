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
// the submit control in the live session. The one exception is a human-driven
// fill (method === human): the person already worked the form live, so we trust
// them to have it ready and don't bounce them back into another handoff.

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

  // No verified submit control on an automated fill: don't invent one. Park for a
  // human to locate and confirm the submit control in the live session.
  return {
    status: INVOICE_STATUS.AWAITING_HUMAN,
    detail: "submit control not found — needs a human to locate and confirm submit",
  };
}

export default readyToSubmit;
