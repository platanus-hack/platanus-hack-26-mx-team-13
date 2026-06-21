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
- date must be ISO 8601 (YYYY-MM-DD, optionally with time).
- merchantNameGuess is a best-effort store name and is a hint only.
- sucursal is the branch/store identifier of the purchase (branch name and/or store number, e.g. "ALSUPER PLUS BOSQUES", "Tienda #058"). This is what a portal's "Sucursal/Tienda" lookup field needs.
- puntoVenta is the register/checkout/terminal number (e.g. "16" from "Punto de Venta: 16", "Caja 3"). Keep it as printed (digits only when numeric).
- paymentMethod is the forma de pago printed on the ticket (e.g. "EFECTIVO", "TARJETA", "TARJETA DE CRÉDITO"). When the payment type is obvious, map it to the SAT code: "01" efectivo, "04" tarjeta de crédito, "28" tarjeta de débito. Otherwise return the raw string as printed.
- For sucursal, puntoVenta and paymentMethod: only fill them if clearly printed; never invent them.`;

/**
 * Parse raw receipt OCR text into structured ticket fields using Claude Haiku.
 *
 * @param {string} rawText - The OCR text returned by Google Vision.
 * @returns {Promise<{rfcEmisor: string|null, folio: string|null, total: number|null, subtotal: number|null, date: string|null, merchantNameGuess: string|null, sucursal: string|null, puntoVenta: string|null, paymentMethod: string|null}>}
 */
export async function parseTicket(rawText) {
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
    system: SYSTEM_PROMPT,
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

  log.info("Ticket parsed", {
    hasRfc: Boolean(parsed.rfcEmisor),
    hasTotal: parsed.total != null,
  });

  return parsed;
}
