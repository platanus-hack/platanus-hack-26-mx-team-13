import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "@/libs/core/logger";

// Hybrid checkpoint classifier — the "AI inside the deterministic path".
//
// A hand-authored portal driver (libs/engine/portals/*) is deterministic and fast,
// but the portal's WORDING varies (a toast says "facturado previamente" today and
// something slightly different tomorrow), so a brittle regex silently misses states.
// At the few decision points that matter — "did the submit validate, or was the
// ticket already invoiced, or was the data rejected?" — a driver can fall back to
// this classifier: hand it the page text plus short merchant-specific `notes`
// describing the possible outcomes, and Claude Haiku CATALOGS the state.
//
// Deterministic FIRST, AI as fallback: callers should run their cheap checks (a
// known success toast, a known error string) before paying for this. Best-effort:
// any failure (no key, model error) returns null so the caller degrades to its
// deterministic verdict instead of throwing.
//
// Env: ANTHROPIC_API_KEY.

const log = createLogger({ component: "engine:classify-outcome" });

// Haiku 4.5 — same cheap/fast model the OCR parse uses; classification is light.
const MODEL = "claude-haiku-4-5";

// Outcomes a post-submit portal state can fall into. `already_invoiced` is terminal
// (nothing to generate); `rejected`/`error` are typically human-resolvable; `unknown`
// means the text didn't clearly indicate any of them.
export const PORTAL_OUTCOMES = Object.freeze([
  "validated",
  "already_invoiced",
  "rejected",
  "error",
  "unknown",
]);

const CLASSIFY_TOOL = {
  name: "classify_outcome",
  description:
    "Classify the result of an automated CFDI invoicing attempt from the portal's page text.",
  input_schema: {
    type: "object",
    properties: {
      outcome: {
        type: "string",
        enum: [...PORTAL_OUTCOMES],
        description:
          "validated: the portal accepted the receipt data and is ready for fiscal data. " +
          "already_invoiced: the receipt was already invoiced before (terminal). " +
          "rejected: the submitted data was invalid (wrong fecha/folio/ID de venta/total, ticket not found). " +
          "error: some other portal error (server error, session expired, maintenance). " +
          "unknown: the text doesn't clearly indicate any of the above.",
      },
      confidence: {
        type: "number",
        description: "Confidence 0..1 that the chosen outcome is correct.",
      },
      reason: {
        type: "string",
        description: "Short reason (Spanish), quoting the key portal text when possible.",
      },
    },
    required: ["outcome", "confidence", "reason"],
  },
};

const SYSTEM = `You are an automated agent driving a Mexican merchant's CFDI (electronic invoice) web portal. You just submitted a purchase receipt's lookup data (fecha de venta, folio, ID de venta, total). Given the portal's CURRENT page text, classify the OUTCOME of that submission using the classify_outcome tool.

Be conservative:
- Only answer "validated" when there is EXPLICIT confirmation the data was accepted (e.g. a "ticket válido" / "datos correctos" message or the fiscal-data form became available).
- Answer "already_invoiced" when the text says the receipt was previously invoiced (e.g. "facturado previamente", "ya fue facturado", "ya se encuentra facturado").
- Answer "rejected" when the data was invalid or the ticket was not found.
- Prefer "unknown" over guessing when the text is ambiguous.`;

/**
 * Classify a portal's post-submit page state.
 *
 * @param {Object} args
 * @param {string} args.pageText - Whole-page text (whitespace-collapsed) after the submit.
 * @param {string} [args.notes] - Merchant-specific notes describing the possible outcomes.
 * @returns {Promise<{ outcome: string, confidence: number|null, reason: string }|null>}
 *   null on any failure (caller should fall back to its deterministic verdict).
 */
export async function classifyPortalOutcome({ pageText, notes } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !pageText || !String(pageText).trim()) return null;

  try {
    const anthropic = new Anthropic({ apiKey });
    const userContent = [
      notes ? `Merchant-specific notes:\n${notes}` : "",
      `Portal page text (whitespace-collapsed, truncated):\n${String(pageText).slice(0, 4000)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
      messages: [{ role: "user", content: userContent }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse) return null;

    const { outcome, confidence, reason } = toolUse.input || {};
    if (!PORTAL_OUTCOMES.includes(outcome)) return null;

    log.info("Portal outcome classified", { outcome, confidence });
    return {
      outcome,
      confidence: typeof confidence === "number" ? confidence : null,
      reason: typeof reason === "string" ? reason : "",
    };
  } catch (error) {
    log.warn("classifyPortalOutcome failed (non-fatal)", { message: error?.message });
    return null;
  }
}

export default classifyPortalOutcome;
