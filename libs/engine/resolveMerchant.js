// resolveMerchant — identify which KnownMerchant a ticket belongs to. Shared by
// the OCR route (to fetch field hints + backfill the canonical RFC) and the engine's
// resolve_portal node (to find the portal/recipe). Replaces the old brittle
// exact-normalized-name match that failed on branch-suffixed names ("OXXO Cuauhtémoc").
//
// Tiers, cheapest → most expensive (stop at the first hit):
//   1. rfc        — exact RFC emisor (deterministic key, free).
//   2. name-exact — exact normalized name OR alias (free).
//   3. text       — Mongo $text (BM25) candidate search; auto-accept a clear winner.
//   4. ai         — Claude Haiku disambiguation, only when BM25 is ambiguous.
//   5. none       — nothing convincing; caller falls back (Firecrawl discovery).
//
// Leaf module: imports only KnownMerchant + the Anthropic SDK, so both callers can
// depend on it without a cycle. Every tier is best-effort — a thrown query (e.g. a
// missing $text index) or AI outage degrades to the next tier / "none", never throws.

import Anthropic from "@anthropic-ai/sdk";
import KnownMerchant from "@/models/KnownMerchant";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:resolve-merchant" });

// Haiku 4.5 — same cheap/fast model the OCR parse uses.
const MODEL = "claude-haiku-4-5";

// BM25 auto-accept thresholds (Mongo textScore). Conservative on purpose: a wrong
// auto-accept poisons the shared registry for everyone, so anything ambiguous falls
// to the (cheap) AI tier instead.
const BM25_ACCEPT_SCORE = 3.0; // top candidate must score at least this…
const BM25_ACCEPT_GAP = 1.5; // …and beat the runner-up by at least this.
const CANDIDATE_LIMIT = 5;
const OCR_QUERY_CHARS = 200; // header slice used as the search query when there's no name guess

/**
 * @typedef {Object} MerchantResolution
 * @property {Object|null} merchant - The resolved KnownMerchant (doc or lean), or null.
 * @property {number} confidence - 0..1.
 * @property {"rfc"|"name-exact"|"text"|"ai"|"none"} method
 */

/**
 * Resolve a ticket's merchant from the KnownMerchant registry.
 *
 * @param {Object} args
 * @param {string|null} [args.rfcEmisor] - Issuing RFC if the ticket carries one.
 * @param {string|null} [args.nameGuess] - OCR merchant-name guess.
 * @param {string|null} [args.ocrText] - Raw OCR text (used for BM25 when there's no nameGuess).
 * @returns {Promise<MerchantResolution>}
 */
export async function resolveMerchant({ rfcEmisor, nameGuess, ocrText } = {}) {
  // Tier 1 — exact RFC (deterministic).
  const rfc = (rfcEmisor || "").trim();
  if (rfc) {
    const byRfc = await KnownMerchant.findByRfc(rfc);
    if (byRfc) return { merchant: byRfc, confidence: 1, method: "rfc" };
  }

  // Tier 2 — exact normalized name / alias (free; preserves the old fast path).
  if (nameGuess && nameGuess.trim()) {
    const byName = await KnownMerchant.findByName(nameGuess);
    if (byName) return { merchant: byName, confidence: 0.95, method: "name-exact" };
  }

  const query = buildQuery({ nameGuess, ocrText });
  if (!query) return { merchant: null, confidence: 0, method: "none" };

  // Tier 3 — BM25 candidate search.
  let candidates = [];
  try {
    candidates = await KnownMerchant.searchByText(query, CANDIDATE_LIMIT);
  } catch (err) {
    // Most likely the $text index isn't built yet — degrade, don't crash.
    log.warn("Merchant text search failed — skipping BM25/AI tiers", {
      error: String(err?.message || err),
    });
    return { merchant: null, confidence: 0, method: "none" };
  }
  if (!candidates.length) return { merchant: null, confidence: 0, method: "none" };

  const topScore = candidates[0].score ?? 0;
  const secondScore = candidates[1]?.score ?? 0;
  if (topScore >= BM25_ACCEPT_SCORE && topScore - secondScore >= BM25_ACCEPT_GAP) {
    return { merchant: candidates[0], confidence: 0.8, method: "text" };
  }

  // Tier 4 — AI disambiguation (only when BM25 didn't produce a clear winner).
  const chosen = await disambiguateWithAI({ nameGuess, ocrText, candidates });
  if (chosen) {
    return {
      merchant: chosen.merchant,
      confidence: Math.min(chosen.confidence ?? 0.7, 0.9),
      method: "ai",
    };
  }

  // Tier 5 — nothing convincing.
  return { merchant: null, confidence: 0, method: "none" };
}

/**
 * Build the $text query: prefer the OCR name guess, else a header slice of the raw
 * OCR text (the merchant brand is almost always at the top). Double-quotes are
 * stripped so the query is never accidentally treated as a phrase search.
 */
function buildQuery({ nameGuess, ocrText }) {
  const name = (nameGuess || "").trim();
  const raw = name || (ocrText || "").trim().slice(0, OCR_QUERY_CHARS);
  return raw.replace(/"/g, " ").trim();
}

/**
 * Ask Claude Haiku to pick the matching candidate (or NONE). Best-effort: a missing
 * key or an API error returns null so the caller falls through to "none".
 *
 * @param {{ nameGuess?: string|null, ocrText?: string|null, candidates: Array<Object> }} args
 * @returns {Promise<{ merchant: Object, confidence: number }|null>}
 */
async function disambiguateWithAI({ nameGuess, ocrText, candidates }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const list = candidates.map((c) => ({
    rfcKey: c.rfcEmisor,
    merchantName: c.merchantName,
    aliases: Array.isArray(c.aliases) ? c.aliases : [],
  }));
  const snippet = (ocrText || "").slice(0, 500);

  const tool = {
    name: "choose_merchant",
    description: "Pick the candidate merchant that matches the receipt, or NONE.",
    input_schema: {
      type: "object",
      properties: {
        choice: {
          type: ["string", "null"],
          description:
            "The rfcKey of the matching candidate, or null if none clearly matches.",
        },
        confidence: { type: "number", description: "0..1 confidence in the choice." },
      },
      required: ["choice", "confidence"],
      additionalProperties: false,
    },
  };

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system:
        "You match a Mexican purchase receipt to the correct merchant from a candidate list. " +
        "Return the matching candidate's rfcKey, or null if none clearly matches. " +
        "Do not guess — when unsure, return null.",
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: `Receipt merchant-name guess: ${nameGuess || "(none)"}

Receipt OCR (first 500 chars):
${snippet}

Candidates:
${JSON.stringify(list, null, 2)}`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    const choice = toolUse?.input?.choice;
    if (!choice) return null;

    const merchant = candidates.find((c) => c.rfcEmisor === choice);
    if (!merchant) return null;

    const confidence =
      typeof toolUse.input.confidence === "number" ? toolUse.input.confidence : 0.7;
    return { merchant, confidence };
  } catch (err) {
    log.warn("AI merchant disambiguation failed — skipping", {
      error: String(err?.message || err),
    });
    return null;
  }
}

export default resolveMerchant;
