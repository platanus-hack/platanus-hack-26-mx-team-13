import { createLogger } from "@/libs/core/logger";

// Google Cloud Vision OCR layer (REST + API key).
//
// Receipts are messy thermal-paper photos, so we lean on Vision's
// DOCUMENT_TEXT_DETECTION (denser-text model) to pull raw text before a cheap
// Haiku pass structures it. See libs/ocr/parseTicket.js for step two.
//
// Auth uses a Vision API key against the REST endpoint — no service-account
// file, no gRPC client. The API key is never sent to the browser (server-only).
//
// Env (see .env.example):
//   GOOGLE_VISION_API_KEY - a Google Cloud Vision API key

const log = createLogger({ component: "ocr:vision" });

const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

/**
 * Run OCR over a receipt image and return its raw text.
 *
 * @param {Buffer} buffer - The image bytes (JPEG/PNG/etc.).
 * @returns {Promise<string>} The full detected text, or "" if Vision found none.
 */
export async function ocrImage(buffer) {
  if (!buffer || !buffer.length) {
    throw new Error("ocrImage: a non-empty image buffer is required");
  }

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Google Vision is not configured — set GOOGLE_VISION_API_KEY in .env.local"
    );
  }

  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: buffer.toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Vision API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const result = data.responses?.[0];

  if (result?.error) {
    throw new Error(`Vision API returned an error: ${result.error.message}`);
  }

  // fullTextAnnotation is the layout-aware result; fall back to the flat
  // textAnnotations[0] if the document model returned nothing.
  const text =
    result?.fullTextAnnotation?.text ||
    result?.textAnnotations?.[0]?.description ||
    "";

  log.info("Vision OCR complete", { textLength: text.length });

  return text;
}
