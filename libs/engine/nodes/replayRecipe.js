// replay_recipe — fill the form by replaying a previously distilled recipe.
//
// STUB. Taken only when resolve_portal found a recipe for the merchant. The real
// node replays the recipe's recorded actions against the live form, throwing
// RECIPE_REPLAY_FAILED when the portal has drifted (so the shell can fall back to
// an AI fill). For now it reports a recipe-method fill with no recorded fields.

import { INVOICE_STATUS, INVOICE_METHOD } from "@/libs/engine/state";

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function replayRecipe(state) {
  return {
    status: INVOICE_STATUS.REPLAYING,
    method: INVOICE_METHOD.RECIPE,
    recipeUsed: true,
    filledFields: [],
    detail: "stub: replayed stored recipe",
  };
}

export default replayRecipe;
