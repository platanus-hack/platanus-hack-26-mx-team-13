import vision from "@google-cloud/vision";
import { createLogger } from "@/libs/core/logger";

// Google Cloud Vision OCR layer.
//
// Receipts are messy thermal-paper photos, so we lean on Vision's
// DOCUMENT_TEXT_DETECTION (denser-text model) to pull raw text before a cheap
// Haiku pass structures it. See libs/ocr/parseTicket.js for step two.
//
// Auth is serverless-friendly: a base64-encoded service-account JSON is decoded
// at runtime and passed in-memory as `credentials`, so no key file ever touches
// disk.
//
// Env (see .env.example):
//   GOOGLE_VISION_CREDENTIALS - base64 of the service-account JSON

const log = createLogger({ component: "ocr:vision" });

// Cache the client on globalThis so Next.js dev hot-reload reuses one instance
// instead of constructing a new ImageAnnotatorClient on every module reload.
let client = globalThis._visionClient;

function getClient() {
  if (client) return client;

  const encoded = process.env.GOOGLE_VISION_CREDENTIALS;
  if (!encoded) {
    throw new Error(
      "Google Vision is not configured — set GOOGLE_VISION_CREDENTIALS (base64 service-account JSON) in .env.local"
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch (error) {
    throw new Error(
      `GOOGLE_VISION_CREDENTIALS is not valid base64-encoded JSON: ${error.message}`
    );
  }

  client = globalThis._visionClient = new vision.ImageAnnotatorClient({
    credentials,
    projectId: credentials.project_id,
  });

  return client;
}

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

  const [result] = await getClient().documentTextDetection({
    image: { content: buffer },
  });

  // fullTextAnnotation is the layout-aware result; fall back to the flat
  // textAnnotations[0] if the document model returned nothing.
  const text =
    result.fullTextAnnotation?.text ||
    result.textAnnotations?.[0]?.description ||
    "";

  log.info("Vision OCR complete", { textLength: text.length });

  return text;
}
