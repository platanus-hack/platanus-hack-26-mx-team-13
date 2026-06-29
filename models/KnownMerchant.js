import mongoose from "mongoose";
import toJSON from "./plugins/toJSON.js";
import { normalizeName } from "@/libs/text/normalizeName";

// KnownMerchant — the RFC-emisor → portal-URL registry. This is the
// network-effect asset: once any user discovers a merchant's invoicing portal,
// every later run for that RFC skips discovery and goes straight to the URL.
// One row per merchant (unique RFC emisor).

const knownMerchantSchema = new mongoose.Schema(
  {
    // Merchant key — the issuing RFC. Unique, stored uppercase/trimmed.
    rfcEmisor: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    // Display name of the merchant.
    merchantName: { type: String, trim: true, default: null },
    // Normalized name for fuzzy lookups (lowercased/stripped).
    normalizedName: { type: String, trim: true, default: null },
    // The merchant's CFDI invoicing portal URL.
    invoiceUrl: { type: String, trim: true, default: null },
    // Free-form operator notes (quirks, login hints, etc.).
    notes: { type: String, default: null },
    // Alternate names / spellings the OCR may yield (e.g. "OXXO Cuauhtémoc",
    // "Sams", "Home Depot Mexico"). Used by findByName + the $text search so a
    // branch-suffixed name still resolves to the canonical merchant.
    aliases: { type: [String], default: [] },
    // Static admin metadata that steers OCR extraction for THIS merchant's receipts
    // (orthogonal to the versioned MerchantRecipe, which is about portal steps).
    fieldHints: {
      // Field labels the parser should hunt for, e.g. ["Folio de venta (Fol_Vta)"].
      important: { type: [String], default: [] },
      // Free-form guidance appended to the extraction prompt.
      notes: { type: String, default: null },
      // Optional ticket-label → billing dataKey map (consumed later; v2).
      fieldMap: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

/**
 * Look up a merchant by RFC emisor.
 * @param {string} rfcEmisor
 * @returns {Promise<mongoose.Document|null>}
 */
knownMerchantSchema.statics.findByRfc = function findByRfc(rfcEmisor) {
  if (!rfcEmisor) return Promise.resolve(null);
  return this.findOne({ rfcEmisor: rfcEmisor.trim().toUpperCase() });
};

/**
 * Look up a merchant by display name, matching on its normalized form. This is the
 * PRIMARY join key: most tickets don't print the issuing RFC, but the OCR almost
 * always yields a merchant name. Exact normalized match (no fuzzy/partial) so two
 * different merchants can't collide.
 * @param {string} name
 * @returns {Promise<mongoose.Document|null>}
 */
knownMerchantSchema.statics.findByName = function findByName(name) {
  const normalized = normalizeName(name);
  if (!normalized) return Promise.resolve(null);
  // Match the canonical normalizedName OR any stored alias (aliases are stored
  // already-normalized), so "OXXO Cuauhtémoc" → "oxxo cuauhtemoc" can resolve when
  // it's listed as an alias even if it isn't the canonical name.
  return this.findOne({
    $or: [{ normalizedName: normalized }, { aliases: normalized }],
  });
};

/**
 * BM25 candidate search over the merchant text index (merchantName / aliases /
 * normalizedName). Returns up to `limit` candidates, each with a `score`
 * (textScore), best first. Requires the "merchant_text" index (built by the model
 * or the seed). Lean docs — read-only candidates for the resolver.
 * @param {string} query - Free-text query (a name guess or an OCR header slice).
 * @param {number} [limit=5]
 * @returns {Promise<Array<Object>>}
 */
knownMerchantSchema.statics.searchByText = function searchByText(query, limit = 5) {
  const q = (query || "").trim();
  if (!q) return Promise.resolve([]);
  return this.find({ $text: { $search: q } }, { score: { $meta: "textScore" } })
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .lean();
};

/**
 * Create or update the registry entry for a merchant RFC. Only the provided
 * fields are written; the RFC key is normalized and cannot be overridden.
 * @param {string} rfcEmisor
 * @param {Object} [data] - Fields to set (merchantName, normalizedName, invoiceUrl, notes).
 * @returns {Promise<mongoose.Document>}
 */
knownMerchantSchema.statics.upsert = function upsert(rfcEmisor, data = {}) {
  const rfc = rfcEmisor.trim().toUpperCase();
  // Drop the key from data so it can't clobber the normalized RFC.
  const { rfcEmisor: _ignored, ...fields } = data;
  return this.findOneAndUpdate(
    { rfcEmisor: rfc },
    { $set: { ...fields, rfcEmisor: rfc } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

// Single text index (Mongo allows only ONE per collection) powering searchByText:
// the merchant name is the strongest signal, then aliases, then the normalized name.
// The seed script (scripts/seed-merchant.mjs) also ensures this index exists in prod
// rather than relying solely on autoIndex.
knownMerchantSchema.index(
  { merchantName: "text", aliases: "text", normalizedName: "text" },
  { name: "merchant_text", weights: { merchantName: 5, aliases: 4, normalizedName: 2 } }
);

// Convert mongoose docs to clean JSON (_id -> id, drop __v).
knownMerchantSchema.plugin(toJSON);

// Hot-reload guard: reuse the compiled model if it already exists.
export default mongoose.models.KnownMerchant ||
  mongoose.model("KnownMerchant", knownMerchantSchema);
