import mongoose from "mongoose";
import toJSON from "./plugins/toJSON.js";

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
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

/** Normalize a name to match normalizedName: lowercase, strip diacritics, drop punctuation. */
function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
  return this.findOne({ normalizedName: normalized });
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

// Convert mongoose docs to clean JSON (_id -> id, drop __v).
knownMerchantSchema.plugin(toJSON);

// Hot-reload guard: reuse the compiled model if it already exists.
export default mongoose.models.KnownMerchant ||
  mongoose.model("KnownMerchant", knownMerchantSchema);
