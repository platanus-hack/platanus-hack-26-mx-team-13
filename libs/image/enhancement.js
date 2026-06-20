import sharp from "sharp";
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

// Target width for low-resolution upscaling (kept as downscale-only via
// withoutEnlargement, so this only ever shrinks oversized photos).
const TARGET_WIDTH = 1800;

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
    const quality = await analyzeImageQuality(buffer);

    // Already good enough — don't touch the bytes.
    if (!quality.needsProcessing) {
      return buffer;
    }

    let pipeline = sharp(buffer);

    // 1. Upscale to a sane width when the resolution is too low for OCR — tiny
    //    print needs more pixels to be legible. lanczos3 keeps edges crisp on
    //    enlargement; fit:inside preserves aspect ratio. No withoutEnlargement
    //    here: the whole point of this branch is to add resolution, so capping
    //    enlargement would make the fix a no-op for the images that need it.
    if (quality.isLowResolution) {
      pipeline = pipeline.resize({
        width: TARGET_WIDTH,
        fit: "inside",
        kernel: "lanczos3",
      });
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

    log.info("Image enhanced for OCR", {
      inputBytes: buffer.length,
      outputBytes: output.length,
      applied: {
        resize: quality.isLowResolution,
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
