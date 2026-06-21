import mongoose from "mongoose";
import { BILLING_DATA_KEYS } from "@/libs/engine/billingDataKeys";
import toJSON from "./plugins/toJSON.js";

// MerchantRecipe — the deterministic playbook for invoicing one merchant,
// keyed by the merchant's RFC emisor. A recipe is an ordered list of browser
// steps that the replay node executes with zero AI. Recipes are versioned:
// re-distilling a portal creates a new version and deactivates the old one, so
// there is at most one active recipe per RFC at a time.

// Browser action a single step performs.
const STEP_ACTIONS = [
  "navigate",
  "click",
  "fill",
  "select",
  "wait",
  "waitForNavigation",
  "keypress",
];

// Logical billing keys a `fill`/`select` step pulls its value from. Derived from
// the billingData assembler's BILLING_DATA_KEYS (single source of truth) so the
// recipe schema can never drift from the values the fill step can actually
// resolve — a key like `taxRegimeFormatted` missing here would reject an
// otherwise-valid distilled recipe at save time. `null` (in the step enum below)
// means the step uses `staticValue` instead of a dataKey.
const DATA_KEYS = BILLING_DATA_KEYS;

// How to locate the target element. Multiple strategies are kept so replay can
// fall back (css → xpath → text) and self-healing can re-match by attributes.
const selectorSchema = new mongoose.Schema(
  {
    css: { type: String, default: null },
    xpath: { type: String, default: null },
    text: { type: String, default: null },
    attributes: {
      id: { type: String, default: null },
      name: { type: String, default: null },
      ariaLabel: { type: String, default: null },
      placeholder: { type: String, default: null },
      type: { type: String, default: null },
    },
  },
  { _id: false }
);

// One ordered step of a recipe.
const stepSchema = new mongoose.Schema(
  {
    // Execution order (1-based).
    order: { type: Number, required: true },
    // What this step does.
    action: { type: String, enum: STEP_ACTIONS, required: true },
    // How to find the target element (not needed for navigate/wait).
    selector: { type: selectorSchema, default: () => ({}) },
    // Billing key whose value fills this step; null when using staticValue.
    dataKey: { type: String, enum: [...DATA_KEYS, null], default: null },
    // Literal value to use when there is no dataKey (e.g. a fixed URL or option).
    staticValue: { type: String, default: null },
    // Pause after the step, in ms.
    waitAfterMs: { type: Number, default: null },
    // Selector to wait for before continuing.
    waitForSelector: { type: String, default: null },
    // Key to press for keypress actions (e.g. "Enter", "Tab").
    key: { type: String, default: null },
    // Human-readable note about what the step does.
    description: { type: String, default: null },
  },
  { _id: false }
);

const merchantRecipeSchema = new mongoose.Schema(
  {
    // Merchant key — the issuing RFC. Stored uppercase/trimmed.
    rfcEmisor: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    // Display name of the merchant.
    merchantName: { type: String, trim: true, default: null },
    // Normalized name for fuzzy lookups (lowercased/stripped).
    normalizedName: { type: String, trim: true, default: null },
    // Portal URL this recipe drives.
    invoiceUrl: { type: String, trim: true, default: null },

    // Versioning — only one active recipe per RFC.
    version: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },

    // The ordered playbook.
    steps: { type: [stepSchema], default: [] },

    // How the recipe was produced.
    recordedVia: { type: String, enum: ["ai", "human"], default: "ai" },

    // Health metrics — drive auto-deactivation and recipe quality scoring.
    usageCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    lastFailureReason: { type: String, default: null },
    lastValidatedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// Number of consecutive-or-total failures after which a recipe self-deactivates.
const MAX_FAILURES = 5;

/**
 * Find the active recipe for a merchant RFC, newest version first.
 * @param {string} rfcEmisor
 * @returns {Promise<mongoose.Document|null>}
 */
merchantRecipeSchema.statics.findActiveByRfc = function findActiveByRfc(
  rfcEmisor
) {
  if (!rfcEmisor) return Promise.resolve(null);
  return this.findOne({
    rfcEmisor: rfcEmisor.trim().toUpperCase(),
    isActive: true,
  }).sort({ version: -1 });
};

/**
 * Record a successful run: bump usage + success counters and mark validated.
 * @param {string|mongoose.Types.ObjectId} id
 * @returns {Promise<mongoose.Document|null>}
 */
merchantRecipeSchema.statics.recordSuccess = function recordSuccess(id) {
  return this.findByIdAndUpdate(
    id,
    {
      $inc: { usageCount: 1, successCount: 1 },
      $set: { lastValidatedAt: new Date() },
    },
    { new: true }
  );
};

/**
 * Record a failed run: bump usage + failure counters, store the reason, and
 * auto-deactivate once the recipe has failed MAX_FAILURES times.
 * @param {string|mongoose.Types.ObjectId} id
 * @param {string} reason
 * @returns {Promise<mongoose.Document|null>}
 */
merchantRecipeSchema.statics.recordFailure = async function recordFailure(
  id,
  reason
) {
  const recipe = await this.findById(id);
  if (!recipe) return null;

  recipe.usageCount += 1;
  recipe.failureCount += 1;
  recipe.lastFailureReason = reason ?? null;
  if (recipe.failureCount >= MAX_FAILURES) {
    recipe.isActive = false;
  }

  await recipe.save();
  return recipe;
};

/**
 * Create a new active recipe version for a merchant and retire the prior ones,
 * bumping the version above the highest existing one.
 *
 * Ordering matters: the replacement is created (and validated/persisted) BEFORE
 * the old active recipes are deactivated. If the new recipe is invalid (bad
 * step action/dataKey, invalid recordedVia, ...), create() throws first and the
 * previously working recipe stays active — the merchant is never left with zero
 * active recipes. The only transient state is "two active", which
 * findActiveByRfc resolves to the newest version.
 *
 * @param {string} rfcEmisor
 * @param {Array<Object>} steps
 * @param {string} invoiceUrl
 * @param {Object} [opts] - Extra fields (merchantName, normalizedName, recordedVia, ...).
 * @returns {Promise<mongoose.Document>}
 */
merchantRecipeSchema.statics.createNewVersion = async function createNewVersion(
  rfcEmisor,
  steps,
  invoiceUrl,
  opts = {}
) {
  const rfc = rfcEmisor.trim().toUpperCase();

  // Highest version so far (active or not), so versions are monotonic per RFC.
  const latest = await this.findOne({ rfcEmisor: rfc })
    .sort({ version: -1 })
    .select("version");
  const nextVersion = latest ? latest.version + 1 : 1;

  // Create + validate the replacement first. A validation failure throws here,
  // before any deactivation, so the existing active recipe is left untouched.
  // Structural fields win over opts so callers can't accidentally override them.
  const created = await this.create({
    ...opts,
    rfcEmisor: rfc,
    steps: steps ?? [],
    invoiceUrl: invoiceUrl ?? null,
    version: nextVersion,
    isActive: true,
  });

  // Only now retire the prior active recipes (everything except the new one).
  await this.updateMany(
    { rfcEmisor: rfc, isActive: true, _id: { $ne: created._id } },
    { $set: { isActive: false } }
  );

  return created;
};

// Active-recipe lookups by merchant.
merchantRecipeSchema.index({ rfcEmisor: 1, isActive: 1 });
// Version history / next-version computation.
merchantRecipeSchema.index({ rfcEmisor: 1, version: 1 });

// Convert mongoose docs to clean JSON (_id -> id, drop __v).
merchantRecipeSchema.plugin(toJSON);

// Hot-reload guard: reuse the compiled model if it already exists.
export default mongoose.models.MerchantRecipe ||
  mongoose.model("MerchantRecipe", merchantRecipeSchema);
