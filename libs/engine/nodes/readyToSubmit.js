// ready_to_submit — the form is filled and the run is parked for submission.
//
// STUB. Terminal success state of this pipeline: the form is complete and the
// submit control located, but the engine does not click submit here — final
// submission (and the move to `done`) is a later, human-confirmed step. The real
// node verifies the filled form and captures submitButtonSelector. For now it
// reports a placeholder selector.

import { INVOICE_STATUS } from "@/libs/engine/state";

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function readyToSubmit(state) {
  return {
    status: INVOICE_STATUS.READY_TO_SUBMIT,
    submitButtonSelector: state.submitButtonSelector || "#submit",
    detail: "stub: form ready, awaiting submit confirmation",
  };
}

export default readyToSubmit;
