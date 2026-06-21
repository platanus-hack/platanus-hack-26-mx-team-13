// Engine contract — the canonical list of billing dataKeys.
//
// A "dataKey" names one logical value the fill step writes into a merchant's CFDI
// form (see billingData.js for how each value is assembled). This list is the
// SINGLE SOURCE OF TRUTH for that set: the billingData assembler re-exports it,
// the fill/distill steps map form fields onto it, and the MerchantRecipe schema
// constrains its step `dataKey` enum to it — so a distilled recipe can only ever
// reference a key the assembler can actually resolve.
//
// It lives in its own dependency-free module (no models / db imports) so the
// mongoose schema can import it without pulling in the assembler's heavy graph,
// mirroring how models already import lightweight contract constants from
// libs/engine (e.g. state.js, errorTypes.js).
//
// @type {ReadonlyArray<string>}
export const BILLING_DATA_KEYS = Object.freeze([
  "rfc",
  "businessName",
  "taxRegime",
  "taxRegimeFormatted",
  "postalCode",
  "cfdiUsage",
  "paymentMethod",
  "email",
  "folio",
  "total",
  "subtotal",
  "date",
  "sucursal",
  "puntoVenta",
  "terminal",
]);

export default BILLING_DATA_KEYS;
