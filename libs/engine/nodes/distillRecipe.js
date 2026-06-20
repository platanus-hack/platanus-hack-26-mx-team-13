// distill_recipe — turn a successful ai/human fill into a reusable recipe.
//
// STUB. Runs only after a non-recipe fill succeeds. The real node compresses
// recordedActions into a stable Recipe (selectors + ordered actions + submit
// button) keyed on the merchant rfcEmisor, so future runs take the cheap replay
// path. Best-effort: a failure here must not fail the run. For now it just marks
// the distilling phase.

import { INVOICE_STATUS } from "@/libs/engine/state";

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function distillRecipe(state) {
  return {
    status: INVOICE_STATUS.DISTILLING,
    detail: "stub: distilled recipe from recorded actions",
  };
}

export default distillRecipe;
