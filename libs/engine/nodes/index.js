// Engine nodes barrel — one import site for the invoicing pipeline.
//
// Each node is an async (state) => Partial<InvoiceState> following the contract in
// libs/engine/node.js. These are STUBS for now (placeholder returns); the real
// implementations land in later issues. The task shell (trigger/processInvoice.js)
// runs them in order via runNode().

export { resolvePortal } from "./resolvePortal.js";
export { initNavigate } from "./initNavigate.js";
export { reachForm } from "./reachForm.js";
export { replayRecipe } from "./replayRecipe.js";
export { fillForm } from "./fillForm.js";
export { distillRecipe } from "./distillRecipe.js";
export { readyToSubmit } from "./readyToSubmit.js";
