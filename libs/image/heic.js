import { createLogger } from "@/libs/core/logger";

// HEIC/HEIF handling.
//
// iPhones shoot HEIC (HEVC-coded) by default, so a large share of receipt photos
// arrive as HEIC. Neither Google Vision nor browsers (outside Safari) read it, and
// our prebuilt Sharp/libvips has no HEVC decoder ("compression format not built
// in"). So we transcode HEIC → JPEG once, server-side, before OCR — and persist the
// JPEG back so the thumbnail renders too.
//
// heic-convert (libheif-js, pure WASM) is lazy-imported — same reason QR/Sharp are
// in the OCR route: keep the heavy module out of the `next build` page-data step.

const log = createLogger({ component: "image:heic" });

// ISO-BMFF brands that imply a HEVC-coded HEIF (i.e. true HEIC the WASM decoder
// handles). AVIF ("avif"/"avis") is intentionally excluded — it's AV1, not HEVC.
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "heif",
]);

/**
 * Detect HEIC by its ISO-BMFF `ftyp` box: bytes 4–8 are "ftyp" and the major brand
 * (bytes 8–12) is a HEVC-coded HEIF brand.
 *
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isHeic(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer.toString("latin1", 4, 8) !== "ftyp") return false;
  const brand = buffer.toString("latin1", 8, 12).trim().toLowerCase();
  return HEIC_BRANDS.has(brand);
}

/**
 * Transcode HEIC bytes to JPEG. Throws if the bytes aren't a decodable HEIC, so
 * the caller can surface a clear "unsupported image" error.
 *
 * @param {Buffer} buffer - HEIC image bytes.
 * @param {number} [quality=0.85] - JPEG quality (0–1, heic-convert's scale).
 * @returns {Promise<Buffer>} JPEG bytes.
 */
export async function heicToJpeg(buffer, quality = 0.85) {
  const convert = (await import("heic-convert")).default;
  const out = await convert({ buffer, format: "JPEG", quality });
  const jpeg = Buffer.from(out);
  log.info("HEIC converted to JPEG", { inBytes: buffer.length, outBytes: jpeg.length });
  return jpeg;
}
