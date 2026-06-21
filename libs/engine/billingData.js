// Engine contract — billingData assembly.
//
// The fill step (recipe replay / AI / human) drives a merchant's CFDI portal by
// writing one logical value per form field. Each field a recipe knows how to fill
// is named by a stable "dataKey". This module produces the single object, keyed by
// those dataKeys, that the fill step reads from — assembled from three sources:
//
//   - Company  (the user's fiscal profile, parsed from the CSF) → who is invoicing.
//   - Ticket   (the extracted receipt fields)                   → what was bought.
//   - User     (the account)                                    → where to send it.
//
// Every value is nullable: receipts and profiles are incomplete in the wild, and a
// missing field is expected, not an error. The one hard requirement is a Company
// with an RFC — without it there is nobody to invoice, so we throw
// MISSING_COMPANY_DATA. Resolving a single dataKey is done with getBillingValue().

import connectMongoose from "@/libs/core/mongoose";
import Company from "@/models/Company";
import Ticket from "@/models/Ticket";
import User from "@/models/User";
import { getTaxRegimeName } from "@/data/sat-catalogs";
import { ENGINE_ERRORS } from "./errorTypes.js";
import { engineError } from "./node.js";

/**
 * @typedef {Object} BillingData
 * The values the fill step writes into a portal, keyed by recipe dataKey. Every
 * field is nullable. Fields are grouped by source:
 *
 * From Company (fiscal profile):
 * @property {string|null} rfc - Registro Federal de Contribuyentes (always present when assembled).
 * @property {string|null} businessName - Legal/fiscal name (razón social).
 * @property {string|null} taxRegime - Primary SAT tax-regime code (e.g. "626").
 * @property {string|null} taxRegimeFormatted - Human-readable regime name for that code.
 * @property {string|null} postalCode - Fiscal address postal code (código postal).
 * @property {string|null} cfdiUsage - Uso de CFDI; defaults to "G03" (Gastos en general) since no Company field captures it yet — the most common uso for expense receipts.
 * @property {string|null} paymentMethod - Forma/método de pago; prefers extracted.paymentMethod, else defaults to "PUE" (Pago en una sola exhibición).
 *
 * From User (account):
 * @property {string|null} email - Address the invoice (CFDI) should be sent to.
 *
 * From Ticket (extracted receipt):
 * @property {string|null} folio - Receipt folio / ticket number.
 * @property {number|null} total - Grand total.
 * @property {number|null} subtotal - Subtotal before tax.
 * @property {Date|null} date - Purchase date (formatting is the fill step's concern).
 * @property {string|null} sucursal - Branch/store identifier from the receipt (lookup gate).
 * @property {string|null} puntoVenta - Register/checkout/POS number from the receipt (lookup gate).
 * @property {string|null} terminal - Terminal identifier; not yet extracted → null for now.
 */

// The closed set of recipe dataKeys — exactly the keys of a BillingData object.
// A recipe maps each form field it fills to one of these. Defined once in
// billingDataKeys.js (single source of truth) and re-exported here so the fill /
// distilling steps and the MerchantRecipe schema all share the same list.
export { BILLING_DATA_KEYS } from "@/libs/engine/billingDataKeys";

// Read the first element of a value that may be an array, a scalar, or absent.
// Company.taxRegime is a [String] of codes; a portal form takes a single regime,
// so we fill with the primary (first) one.
function firstOf(value) {
  if (Array.isArray(value)) return value.length ? value[0] : null;
  return value ?? null;
}

/**
 * Assemble the billingData object for one invoice run.
 *
 * Fetches the user's Company (fiscal profile), the Ticket (extracted receipt
 * fields), and the User (account), then projects them onto the recipe dataKeys.
 *
 * @param {string} ticketId - The Ticket being invoiced (Ticket _id).
 * @param {string} userId - Owner of the ticket (User _id); also keys the Company.
 * @returns {Promise<BillingData>} Every dataKey resolved to a value or null.
 * @throws {Error & { errorType: string }} MISSING_COMPANY_DATA when the user has
 *   no active Company, or that Company has no RFC. Also throws (UNKNOWN) when no
 *   Ticket matches the (ticketId, userId) pair.
 */
export async function assembleBillingData(ticketId, userId) {
  await connectMongoose();

  // Company is keyed by userId. A user may hold more than one (multiple RFCs);
  // prefer the most recently created active profile. The Ticket is scoped to the
  // same userId so a mismatched id can never pair one user's receipt with another
  // user's fiscal profile. User is looked up by id. All three reads are
  // independent → run them together.
  const [company, ticket, user] = await Promise.all([
    Company.findOne({ userId, isActive: true })
      .sort({ createdAt: -1 })
      .lean(),
    Ticket.findOne({ _id: ticketId, userId }).lean(),
    User.findById(userId).lean(),
  ]);

  if (!company || !company.rfc) {
    throw engineError(
      ENGINE_ERRORS.MISSING_COMPANY_DATA.description,
      ENGINE_ERRORS.MISSING_COMPANY_DATA.code
    );
  }

  // No ticket for this user/id pair: refuse to assemble against an empty or
  // someone else's receipt rather than silently returning all-null receipt fields.
  if (!ticket) {
    throw engineError(
      `Ticket ${ticketId} not found for this user`,
      ENGINE_ERRORS.UNKNOWN.code
    );
  }

  const regimeCode = firstOf(company.taxRegime);
  const extracted = ticket.extracted || {};

  return {
    // Company (fiscal profile)
    rfc: company.rfc ?? null,
    businessName: company.businessName ?? null,
    taxRegime: regimeCode,
    taxRegimeFormatted: getTaxRegimeName(regimeCode),
    postalCode: company.fiscalAddress?.postalCode ?? null,
    // Full fiscal address from the CSF (some portals, e.g. OXXO, ask for it).
    street:
      [company.fiscalAddress?.streetType, company.fiscalAddress?.streetName]
        .filter(Boolean)
        .join(" ") || null,
    exteriorNumber: company.fiscalAddress?.exteriorNumber ?? null,
    interiorNumber: company.fiscalAddress?.interiorNumber ?? null,
    colonia: company.fiscalAddress?.neighborhood ?? null,
    municipality: company.fiscalAddress?.municipality ?? null,
    state: company.fiscalAddress?.state ?? null,
    country: company.fiscalAddress?.country ?? null,
    // CFDI defaults: most portals REQUIRE these, so a null leaves the form
    // incomplete. No Company field captures them yet, so we fall back to the
    // most common SAT values for expense receipts.
    // "G03" = Gastos en general (the usual uso de CFDI for expenses).
    cfdiUsage: "G03",
    // Prefer a value the OCR extracted from the ticket; else "PUE" = Pago en
    // una sola exhibición (single-payment, by far the most common método).
    paymentMethod: extracted.paymentMethod ?? "PUE",

    // User (account)
    email: user?.email ?? null,

    // Ticket (extracted receipt)
    folio: extracted.folio ?? null,
    total: extracted.total ?? null,
    subtotal: extracted.subtotal ?? null,
    date: extracted.date ?? null,
    sucursal: extracted.sucursal ?? null,
    puntoVenta: extracted.puntoVenta ?? null,
    // Not yet extracted from receipts; surfaced as null.
    terminal: extracted.terminal ?? null,
  };
}

/**
 * Resolve a single recipe dataKey against an assembled billingData object.
 * Returns null for an unknown key or a missing/undefined value, so the fill step
 * can treat "no value" uniformly.
 *
 * @param {BillingData} billingData - The object from assembleBillingData().
 * @param {string} dataKey - A recipe dataKey (one of BILLING_DATA_KEYS).
 * @returns {*} The resolved value, or null.
 */
export function getBillingValue(billingData, dataKey) {
  if (!billingData || !dataKey) return null;
  const value = billingData[dataKey];
  return value === undefined ? null : value;
}

/**
 * Presence map of an assembled billingData — `{ dataKey: boolean }`, true when the
 * value is non-null. Safe to log: it reveals WHICH fiscal/receipt fields the fill
 * step has, never the values themselves. Use this in trigger.log to confirm the
 * agent is driven by the real OCR + CSF data (and to spot missing fields like
 * cfdiUsage) without leaking PII.
 *
 * @param {BillingData} billingData
 * @returns {Record<string, boolean>}
 */
export function redactBillingData(billingData) {
  const out = {};
  for (const k of Object.keys(billingData || {})) {
    out[k] = billingData[k] != null;
  }
  return out;
}
