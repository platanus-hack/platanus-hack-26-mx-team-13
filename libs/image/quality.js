import sharp from "sharp";
import { createLogger } from "@/libs/core/logger";

// Pre-OCR image quality analysis.
//
// Ticket photos are messy thermal-paper receipts: low contrast, blur, bad
// lighting, low resolution. This module inspects an image and reports which of
// those problems it has, so enhancement.js can conditionally fix only what is
// wrong. It is a pure, local Sharp transform — no LLM/API cost.
//
// Every metric defaults to "good quality" on any glitch: a metrics failure must
// never block OCR. analyzeImageQuality never throws.

const log = createLogger({ component: "image:quality" });

// Tunable thresholds. Conservative on purpose — only flag clearly-bad images so
// enhancement stays a no-op on photos that are already fine.
export const QUALITY_THRESHOLDS = {
  // Histogram range (max - min) on a grayscale channel, 0..255. Below this the
  // image is washed out / low-contrast.
  CONTRAST: 100,
  // Variance of the Laplacian (stdev²). The classic "is it blurry" score — low
  // means few sharp edges, i.e. blur.
  BLUR: 100,
  // Much lower variance still: the image is severely blurred and benefits from
  // noise reduction before sharpening.
  BLUR_SEVERE: 30,
  // Smallest side, in pixels. Below this OCR struggles with small print.
  MIN_RESOLUTION: 1000,
  // Grayscale mean, 0..255. Below DARK the photo is underexposed; above BRIGHT
  // it is blown out.
  DARK: 80,
  BRIGHT: 200,
};

// Safe defaults returned whenever analysis can't be completed. "Good quality"
// everywhere so enhancement leaves the original bytes untouched.
function safeDefaults() {
  return {
    isLowContrast: false,
    isBlurry: false,
    isVeryBlurry: false,
    isLowResolution: false,
    isDark: false,
    isBright: false,
    needsProcessing: false,
    metrics: {},
  };
}

/**
 * Analyze an image's OCR-relevant quality metrics.
 *
 * @param {Buffer} buffer - Raw image bytes (JPEG/PNG/etc.).
 * @returns {Promise<Object>} Quality flags + raw metrics. Never throws; returns
 *   safe "good quality" defaults on any error.
 */
export async function analyzeImageQuality(buffer) {
  if (!buffer || !buffer.length) {
    return safeDefaults();
  }

  try {
    const T = QUALITY_THRESHOLDS;

    // Resolution from metadata.
    const meta = await sharp(buffer).metadata();
    const width = meta?.width || 0;
    const height = meta?.height || 0;
    // EXIF orientation (1 = normal). 5-8 rotate 90/270°, swapping on-screen
    // dimensions — enhancement.js needs this to resize the oriented image.
    const orientation = meta?.orientation || 1;
    const isLowResolution =
      width > 0 && height > 0 && Math.min(width, height) < T.MIN_RESOLUTION;

    // Contrast + brightness from grayscale stats. channels[0] is the single
    // grayscale channel; min/max give the histogram range, mean the brightness.
    const stats = await sharp(buffer).grayscale().stats();
    const ch = stats?.channels?.[0];

    let isLowContrast = false;
    let isDark = false;
    let isBright = false;
    let contrastRange = null;
    let brightness = null;

    if (ch && typeof ch.min === "number" && typeof ch.max === "number") {
      contrastRange = ch.max - ch.min;
      isLowContrast = contrastRange < T.CONTRAST;
    }
    if (ch && typeof ch.mean === "number") {
      brightness = ch.mean;
      isDark = brightness < T.DARK;
      isBright = brightness > T.BRIGHT;
    }

    // Blur via variance of the Laplacian: convolve grayscale with a 3×3
    // Laplacian kernel, then the channel stdev² is the focus measure.
    let isBlurry = false;
    let isVeryBlurry = false;
    let blurScore = null;

    const lap = await sharp(buffer)
      .grayscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
      })
      .stats();
    const lapCh = lap?.channels?.[0];
    if (lapCh && typeof lapCh.stdev === "number") {
      blurScore = lapCh.stdev * lapCh.stdev;
      isBlurry = blurScore < T.BLUR;
      isVeryBlurry = blurScore < T.BLUR_SEVERE;
    }

    const needsProcessing =
      isBlurry || isLowContrast || isLowResolution || isDark;

    return {
      isLowContrast,
      isBlurry,
      isVeryBlurry,
      isLowResolution,
      isDark,
      isBright,
      needsProcessing,
      metrics: {
        width,
        height,
        orientation,
        contrastRange,
        brightness,
        blurScore,
      },
    };
  } catch (error) {
    // A metrics glitch must never block OCR — degrade to "good quality".
    log.warn("Image quality analysis failed — assuming good quality", {
      message: error?.message,
    });
    return safeDefaults();
  }
}

export default analyzeImageQuality;
