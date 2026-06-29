// Shared name normalization — the single source of truth for
// KnownMerchant.normalizedName, the merchant resolver (libs/engine/resolveMerchant),
// recipe distillation, and portal resolution. Kept pure (no model/db imports) so any
// layer can depend on it without pulling mongoose.
//
// NOTE: scripts/seed-merchant.mjs keeps its OWN mirror of normalizeName on purpose —
// it runs under the raw `node --env-file` runner where package.json has no
// "type": "module", so a `.js` ESM import would be parsed as CommonJS and fail. Keep
// the two in lockstep: the stored normalizedName must match what this produces.

/**
 * Normalize a name for matching and for KnownMerchant.normalizedName: lowercase,
 * strip diacritics (NFD-decompose, drop all combining marks), drop punctuation,
 * collapse whitespace.
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a name into lowercased, accent-stripped tokens worth matching against a
 * hostname or registry entry. Short tokens (de, la, sa, cv, ...) are dropped as noise.
 * @param {string|null|undefined} name
 * @param {number} [minLen=4] - Minimum token length to keep.
 * @returns {string[]}
 */
export function nameTokens(name, minLen = 4) {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t.length >= minLen);
}
