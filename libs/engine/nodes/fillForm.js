// fill_form — fill the invoicing form from scratch with a browsing agent.
//
// STUB. The default fill path when no recipe exists. The real node drives a
// Stagehand agent to map the user's company data onto the form fields, recording
// each interaction into recordedActions (the raw material distill_recipe turns
// into a reusable recipe) and listing anything it couldn't fill in unfilledFields.
// For now it reports an AI-method fill with empty records.

import { INVOICE_STATUS, INVOICE_METHOD } from "@/libs/engine/state";

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function fillForm(state) {
  return {
    status: INVOICE_STATUS.AI_FILLING,
    method: INVOICE_METHOD.AI,
    filledFields: [],
    recordedActions: [],
    detail: "stub: AI filled the form",
  };
}

export default fillForm;
