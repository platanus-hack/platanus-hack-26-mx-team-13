import { analyzeImageQuality } from "@/libs/image/quality";
import { createLogger } from "@/libs/core/logger";

// Pre-OCR image enhancement.
//
// Builds ONE adaptive Sharp pipeline that applies only the fixes the quality
// metrics flag, then re-encodes for the Vision call. It is best-effort: if
// anything fails, it falls back to the original bytes so OCR never breaks.
//
// Output is JPEG q88 (not PNG): the enhanced image is sent base64-inline to the
// Vision REST API (~10MB inline cap), where a PNG of an ~1800px image bloats the
// payload. JPEG q88 is more than enough quality for OCR.

const log = createLogger({ component: "image:enhancement" });

// Target width for low-resolution upscaling — small print needs more pixels to
// be legible to OCR.
const TARGET_WIDTH = 1800;

// Hard cap on either output dimension. Upscaling a tall/narrow receipt toward
// TARGET_WIDTH could otherwise produce something like 1800x18000, which bloats
// the base64-inlined Vision payload past its limit. Bound both sides so the
// resize can never explode.
const MAX_DIMENSION = 4000;

// Safety cap on the enhanced buffer. If the result is still too large for the
// inline Vision payload (~10MB JSON; base64 adds ~33%), fall back to the
// original bytes rather than risk a Vision 500.
const MAX_OUTPUT_BYTES = 7 * 1024 * 1024;

// Output encoding for the OCR payload.
const JPEG_QUALITY = 88;

/**
 * Enhance an image for OCR.
 *
 * Analyzes the buffer, applies only the flagged corrections, and returns a JPEG
 * buffer. If nothing is flagged, returns the original buffer unchanged. On any
 * failure, falls back to the original buffer (logs a warning, never throws).
 *
 * @param {Buffer} buffer - Raw image bytes (JPEG/PNG/etc.).
 * @returns {Promise<Buffer>} The enhanced (or original) image bytes.
 */
export async function enhanceForOCR(buffer) {
  if (!buffer || !buffer.length) {
    return buffer;
  }

  try {
    // Lazy-load sharp (see quality.js): keeps the native binary out of the
    // `next build` page-data step; the catch below falls back to original bytes.
    const sharp = (await import("sharp")).default;
    const quality = await analyzeImageQuality(buffer);

    // Already good enough — don't touch the bytes.
    if (!quality.needsProcessing) {
      return buffer;
    }

    // Auto-orient from EXIF first. Re-encoding strips the orientation tag, so a
    // sideways phone photo would otherwise reach Vision rotated; .rotate() bakes
    // the orientation into the pixels before we drop the metadata.
    let pipeline = sharp(buffer).rotate();

    // 1. Upscale to a sane width when the resolution is too low for OCR — tiny
    //    print needs more pixels to be legible. lanczos3 keeps edges crisp on
    //    enlargement. We compute the scale ourselves (rather than passing a bare
    //    width) so we can: (a) actually enlarge — withoutEnlargement would make
    //    this branch a no-op for the small images it targets; and (b) clamp the
    //    longer side to MAX_DIMENSION so a tall/narrow receipt can't balloon
    //    into a multi-megapixel image that overflows Vision's inline payload.
    //    Use the *oriented* dimensions: EXIF orientations 5-8 swap width/height,
    //    and the resize runs after .rotate().
    const { width: rawW, height: rawH, orientation } = quality.metrics;
    const swapped = orientation >= 5 && orientation <= 8;
    const w = swapped ? rawH : rawW;
    const h = swapped ? rawW : rawH;
    let resized = false;
    if (quality.isLowResolution && w > 0 && h > 0) {
      // Target the width, but never let either side exceed MAX_DIMENSION, and
      // never downscale here (this branch only adds resolution).
      const scale = Math.max(
        1,
        Math.min(TARGET_WIDTH / w, MAX_DIMENSION / Math.max(w, h))
      );
      if (scale > 1) {
        pipeline = pipeline.resize({
          width: Math.round(w * scale),
          kernel: "lanczos3",
        });
        resized = true;
      }
    }

    // 2. Grayscale always — drops color noise OCR doesn't need.
    pipeline = pipeline.grayscale();

    // 3. Histogram stretch for washed-out, low-contrast receipts.
    if (quality.isLowContrast) {
      pipeline = pipeline.normalize();
    }

    // 4. Sharpen blur; use a stronger sigma when blur is severe.
    if (quality.isBlurry) {
      pipeline = pipeline.sharpen({ sigma: quality.isVeryBlurry ? 2 : 1 });
    }

    // 5. Light median filter only when very blurry — reduces noise without
    //    smearing text edges.
    if (quality.isVeryBlurry) {
      pipeline = pipeline.median(2);
    }

    // 6. Gamma lift for underexposed photos.
    if (quality.isDark) {
      pipeline = pipeline.gamma(1.3);
    }

    // 7. Encode JPEG q88 for a compact inline Vision payload.
    const output = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();

    // Safety net: if the enhanced buffer is too large for the inline Vision
    // payload, fall back to the original bytes rather than risk a 500. (The
    // dimension cap above should prevent this; this guards against any
    // remaining edge case, e.g. a very large original.)
    if (output.length > MAX_OUTPUT_BYTES) {
      log.warn("Enhanced image too large — using original bytes", {
        inputBytes: buffer.length,
        outputBytes: output.length,
        maxBytes: MAX_OUTPUT_BYTES,
      });
      return buffer;
    }

    log.info("Image enhanced for OCR", {
      inputBytes: buffer.length,
      outputBytes: output.length,
      applied: {
        resize: resized,
        normalize: quality.isLowContrast,
        sharpen: quality.isBlurry,
        median: quality.isVeryBlurry,
        gamma: quality.isDark,
      },
    });

    return output;
  } catch (error) {
    // Best-effort: degrade to the original bytes rather than fail OCR.
    log.warn("Image enhancement failed — using original bytes", {
      message: error?.message,
    });
    return buffer;
  }
}

export default enhanceForOCR;
