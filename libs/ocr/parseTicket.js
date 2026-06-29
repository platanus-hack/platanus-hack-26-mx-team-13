import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createLogger } from "@/libs/core/logger";

// Step two of the OCR pipeline: turn Vision's raw receipt text into the small
// set of structured fields the engine needs. We use Claude Haiku — cheap and
// reliable at this kind of extraction — and force a tool call so the model
// must return strict JSON matching our schema instead of prose.
//
// rfcEmisor is the deterministic merchant key downstream; never fuzzy-match by
// name. merchantNameGuess is a hint only.
//
// Env (see .env.example):
//   ANTHROPIC_API_KEY

const log = createLogger({ component: "ocr:parse" });

// Haiku 4.5 — fast/cheap, strong enough for receipt field extraction.
const MODEL = "claude-haiku-4-5";

// The strict shape we ask Haiku to fill. Every field is nullable: receipts are
// messy and a missing field is expected, not an error.
const extractedSchema = z.object({
  rfcEmisor: z.string().nullable(),
  folio: z.string().nullable(),
  total: z.number().nullable(),
  subtotal: z.number().nullable(),
  date: z.string().nullable(),
  merchantNameGuess: z.string().nullable(),
  // Ticket-lookup fields: most MX portals gate the fiscal form behind a lookup that
  // asks for these (branch + POS + folio + total + date) to find the purchase.
  sucursal: z.string().nullable(),
  puntoVenta: z.string().nullable(),
  // Forma de pago printed on the ticket (EFECTIVO/TARJETA/...). Mapped to a SAT
  // code when obvious; otherwise the raw printed string. Feeds the CFDI form.
  paymentMethod: z.string().nullable(),
  // "ID de venta" / operation id (e.g. OXXO's "ID=10CHI50CEC1"). Some lookup gates
  // require it to validate the purchase. Alphanumeric, kept verbatim.
  venta: z.string().nullable(),
});

// JSON Schema mirror of extractedSchema, handed to Claude as a tool definition so
// the response is constrained to this shape.
const EXTRACT_TOOL = {
  name: "extract_ticket",
  description:
    "Return the structured fields extracted from a Mexican purchase receipt (ticket).",
  input_schema: {
    type: "object",
    properties: {
      rfcEmisor: {
        type: ["string", "null"],
        description:
          "The issuing merchant's RFC (Mexican tax ID), e.g. 'ABC123456T1A'. null if not present.",
      },
      folio: {
        type: ["string", "null"],
        description: "Receipt folio / ticket number. null if not present.",
      },
      total: {
        type: ["number", "null"],
        description: "Grand total amount as a number (no currency symbol).",
      },
      subtotal: {
        type: ["number", "null"],
        description: "Subtotal before tax as a number. null if not present.",
      },
      date: {
        type: ["string", "null"],
        description:
          "Purchase date in ISO 8601 (YYYY-MM-DD or full timestamp). null if not present.",
      },
      merchantNameGuess: {
        type: ["string", "null"],
        description:
          "Best guess at the merchant/store name. A hint only — not used as a key.",
      },
      sucursal: {
        type: ["string", "null"],
        description:
          "Branch / store identifier of the purchase: a branch name and/or store number, e.g. 'ALSUPER PLUS BOSQUES', 'Sucursal Centro', 'Tienda #058'. Prefer the most specific branch label printed. null if not present.",
      },
      puntoVenta: {
        type: ["string", "null"],
        description:
          "Point-of-sale / checkout identifier: the register, lane, terminal or 'punto de venta' number, e.g. '16' from 'Punto de Venta: 16', 'Caja 3'. Digits only when it is a number. null if not present.",
      },
      paymentMethod: {
        type: ["string", "null"],
        description:
          "Forma de pago printed on the ticket (EFECTIVO, TARJETA, TARJETA DE CRÉDITO/DÉBITO, etc.). When the payment type is obvious, map it to the SAT code: '01' efectivo, '04' tarjeta de crédito, '28' tarjeta de débito. Otherwise return the raw string as printed. null if not present.",
      },
      venta: {
        type: ["string", "null"],
        description:
          "The 'ID de venta' / operation id printed on the ticket, e.g. OXXO's 'ID=10CHI50CEC1' (return '10CHI50CEC1'). Alphanumeric, copy it verbatim. Distinct from folio. null if not present.",
      },
    },
    required: [
      "rfcEmisor",
      "folio",
      "total",
      "subtotal",
      "date",
      "merchantNameGuess",
      "sucursal",
      "puntoVenta",
      "paymentMethod",
      "venta",
    ],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You extract structured data from the OCR text of Mexican purchase receipts (tickets de compra).

Rules:
- Call the extract_ticket tool exactly once with the fields you find.
- Use null for any field not present in the text. Never invent or guess values for missing fields.
- rfcEmisor is the merchant's RFC (12-13 alphanumeric chars, e.g. "XAXX010101000"). Only fill it if an RFC clearly appears; do not derive it from the merchant name.
- total and subtotal are plain numbers (strip "$", "MXN", thousands separators).
- date must be ISO 8601 (YYYY-MM-DD, optionally with time). Mexican receipts print dates as DD/MM/YYYY — read them that way (e.g. "11/06/2026" is 11 June 2026 → "2026-06-11", NOT 6 November).
- venta is the "ID de venta" / operation id (e.g. OXXO "ID=10CHI50CEC1" → "10CHI50CEC1"). It is alphanumeric and distinct from the numeric folio. Copy it verbatim; null if absent.
- merchantNameGuess is a best-effort store name and is a hint only.
- sucursal is the branch/store identifier of the purchase (branch name and/or store number, e.g. "ALSUPER PLUS BOSQUES", "Tienda #058"). This is what a portal's "Sucursal/Tienda" lookup field needs.
- puntoVenta is the register/checkout/terminal number (e.g. "16" from "Punto de Venta: 16", "Caja 3"). Keep it as printed (digits only when numeric).
- paymentMethod is the forma de pago printed on the ticket (e.g. "EFECTIVO", "TARJETA", "TARJETA DE CRÉDITO"). When the payment type is obvious, map it to the SAT code: "01" efectivo, "04" tarjeta de crédito, "28" tarjeta de débito. Otherwise return the raw string as printed.
- For sucursal, puntoVenta and paymentMethod: only fill them if clearly printed; never invent them.`;

/**
 * Parse raw receipt OCR text into structured ticket fields using Claude Haiku.
 *
 * @param {string} rawText - The OCR text returned by Google Vision.
 * @param {Object} [opts] - Optional per-merchant extraction hints.
 * @param {{ important?: string[], notes?: string|null }|null} [opts.fieldHints] - KnownMerchant.fieldHints to steer extraction.
 * @param {{ merchantName?: string|null }|null} [opts.merchant] - The resolved merchant, for prompt context.
 * @returns {Promise<{rfcEmisor: string|null, folio: string|null, total: number|null, subtotal: number|null, date: string|null, merchantNameGuess: string|null, sucursal: string|null, puntoVenta: string|null, paymentMethod: string|null, venta: string|null}>}
 */
export async function parseTicket(rawText, opts = {}) {
  if (!rawText || !rawText.trim()) {
    throw new Error("parseTicket: rawText is empty");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Anthropic is not configured — set ANTHROPIC_API_KEY in .env.local"
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT + merchantPromptBlock(opts.fieldHints, opts.merchant),
    tools: [EXTRACT_TOOL],
    // Force the model to call our tool so we always get strict JSON back.
    tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Extract the fields from this receipt OCR text:\n\n${rawText}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("parseTicket: model did not return a tool call");
  }

  // Validate against zod so a malformed payload fails loudly rather than
  // silently writing garbage into the Ticket.
  const parsed = extractedSchema.parse(toolUse.input);

  // Deterministic override: a few fields print in rigid, unambiguous formats that
  // regex reads more reliably than the model — the "ID de venta", the folio de
  // venta, and the DD/MM/YYYY date (the model has confused day/month here). When a
  // pattern matches, it WINS over the model output; otherwise we keep the model's.
  const merged = { ...parsed, ...deterministicHints(rawText) };

  log.info("Ticket parsed", {
    hasRfc: Boolean(merged.rfcEmisor),
    hasTotal: merged.total != null,
    hasVenta: Boolean(merged.venta),
  });

  return merged;
}

/**
 * Build a merchant-specific addendum to the system prompt from KnownMerchant
 * fieldHints. Returns "" when there are no usable hints, so the base prompt is
 * unchanged for unknown merchants (backward compatible).
 *
 * @param {{ important?: string[], notes?: string|null }|null|undefined} fieldHints
 * @param {{ merchantName?: string|null }|null|undefined} merchant
 * @returns {string}
 */
function merchantPromptBlock(fieldHints, merchant) {
  if (!fieldHints) return "";
  const important = Array.isArray(fieldHints.important)
    ? fieldHints.important.filter(Boolean)
    : [];
  if (!important.length && !fieldHints.notes) return "";

  const who = merchant?.merchantName
    ? `from ${merchant.merchantName}`
    : "from a known merchant";
  const lines = [
    `\n\nThis receipt is ${who}. It reliably prints the fields below — read them carefully and prefer them when present:`,
  ];
  for (const f of important) lines.push(`- ${f}`);
  if (fieldHints.notes) lines.push(`Notes: ${fieldHints.notes}`);
  return lines.join("\n");
}

/**
 * Regex-extract the fields whose printed format is rigid enough to read
 * deterministically (more reliable than the model for these). Only returns a key
 * when its pattern matched, so the caller merges these OVER the model output
 * without clobbering model values it didn't find.
 *
 * @param {string} rawText - OCR text.
 * @returns {{ venta?: string, folio?: string, date?: string }}
 */
function deterministicHints(rawText) {
  const hints = {};

  // "ID de venta": e.g. "ID=10CHI50CEC1" (OXXO) → "10CHI50CEC1".
  const venta = /\bID\s*[=:]\s*([A-Z0-9]{6,})/i.exec(rawText);
  if (venta) hints.venta = venta[1].toUpperCase();

  // Folio de venta: e.g. "Fol_Vta:8987293", "Folio de venta: 8987293".
  const folio = /\bFol(?:io)?[_\s]*(?:de\s*)?Vta?\.?\s*[:#]?\s*([0-9]{4,})/i.exec(rawText);
  if (folio) hints.folio = folio[1];

  // Date in DD/MM/YYYY (MX format) → ISO YYYY-MM-DD. Guards real day/month ranges
  // so a store number like "31/64/..." can't be misread as a date.
  const date = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(rawText);
  if (date) {
    const [, dd, mm, yyyy] = date;
    const d = +dd;
    const m = +mm;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      hints.date = `${yyyy}-${mm}-${dd}`;
    }
  }

  return hints;
}
