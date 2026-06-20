// reach_form — get from the portal landing page to the invoicing form.
//
// STUB. The real node clicks through the merchant's "facturación" flow (cookie
// banners, RFC/folio lookup, "generar factura" buttons) until the fillable form is
// on screen, throwing FORM_NOT_FOUND when it can't. For now it just marks the form
// reached so the fill step runs.

import { INVOICE_STATUS } from "@/libs/engine/state";

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function reachForm(state) {
  return {
    status: INVOICE_STATUS.REACHING_FORM,
    formReached: true,
    detail: "stub: reached the invoicing form",
  };
}

export default reachForm;
