// resolve_portal — figure out which CFDI portal to drive for this merchant.
//
// STUB. The real node (later issue) resolves portalUrl from, in order: a stored
// recipe for the merchant's rfcEmisor, the merchant directory, or an AI lookup —
// setting urlSource accordingly and, when a recipe exists, recipeId/recipeVersion
// so the pipeline takes the replay branch. For now it returns a placeholder so the
// task shell compiles and the status transitions are observable end-to-end.

import { INVOICE_STATUS } from "@/libs/engine/state";

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function resolvePortal(state) {
  return {
    status: INVOICE_STATUS.RESOLVING_PORTAL,
    // Placeholder URL — a later issue resolves the real portal from the merchant.
    portalUrl: state.portalUrl || "https://example.invalid/facturacion",
    urlSource: "stub",
    detail: "stub: resolved placeholder portal URL",
  };
}

export default resolvePortal;
