import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { getObjectBuffer } from "@/libs/storage/r2";
import { enhanceForOCR } from "@/libs/image/enhancement";
import { ocrImage } from "@/libs/ocr/googleVision";
import { parseTicket } from "@/libs/ocr/parseTicket";
import { resolveMerchant } from "@/libs/engine/resolveMerchant";
import { startInvoiceRun } from "@/libs/engine/startInvoiceRun";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets:ocr" });

// This route reads the session, reaches out to R2/Vision/Anthropic and writes to
// MongoDB — never prerender it.
export const dynamic = "force-dynamic";

// True if the bytes are a PDF (magic header "%PDF"). Used to reject PDF tickets
// before they reach Vision, which only OCRs raster images.
function isPdf(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 // F
  );
}

// True when value is a non-empty http(s) URL.
function isHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Best-effort: pull a Mexican RFC (12-13 chars) out of OCR text — used to seed the
// merchant resolver's exact-RFC tier. Tolerates the dash/space separators tickets
// often print (e.g. OXXO's "CCO-860523-1N4"). Returns the compact RFC, or null.
function extractRfc(text) {
  const m = /\b([A-ZÑ&]{3,4})[-\s]?(\d{6})[-\s]?([A-Z0-9]{3})\b/i.exec(text || "");
  return m ? (m[1] + m[2] + m[3]).toUpperCase() : null;
}

// Whether a URL looks like a facturación portal: a strong signal is "factura",
// "facturacion" or "cfdi" anywhere in the host or path; any http(s) URL is a
// weaker signal we still accept (merchants often print a bare portal domain).
function looksLikeInvoicePortal(url) {
  try {
    const u = new URL(url);
    return /factura|facturacion|cfdi/.test(
      `${u.hostname}${u.pathname}`.toLowerCase()
    );
  } catch {
    return false;
  }
}

// Decode a single QR from the receipt image and, when its payload is a usable
// facturación portal URL, return { portalUrl, params }. params are any query
// params on the QR (folio/total/etc.) we can best-effort backfill onto the
// ticket. Returns null when no QR / no usable URL is found.
//
// Best-effort and NON-FATAL: every failure path (no QR lib, sharp error, decode
// miss, bad URL) returns null and never throws — QR decoding must never break OCR.
//
// sharp + jsqr are lazy-imported (mirrors libs/image/enhancement.js) to keep the
// native sharp binary out of the `next build` page-data step.
async function decodeTicketQr(buffer, ticketId) {
  try {
    if (!buffer || !buffer.length) return null;

    const sharp = (await import("sharp")).default;
    const jsQR = (await import("jsqr")).default;

    // jsQR needs raw RGBA pixels. ensureAlpha() guarantees 4 channels even for
    // a JPEG with no alpha; .rotate() bakes EXIF orientation so a sideways phone
    // photo still presents the QR upright.
    const { data, info } = await sharp(buffer)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const code = jsQR(
      new Uint8ClampedArray(data),
      info.width,
      info.height
    );
    if (!code || !code.data) return null;

    const payload = code.data.trim();
    if (!isHttpUrl(payload)) return null;

    // Accept a clear facturación portal; otherwise accept any http(s) URL as a
    // weaker signal (most ticket QRs that ARE URLs point at the portal).
    if (!looksLikeInvoicePortal(payload)) {
      log.info("Ticket QR is a URL but not an obvious portal — using as weak signal", {
        ticketId,
      });
    }

    // Pull any folio/total-ish query params for best-effort backfill below.
    let params = {};
    try {
      params = Object.fromEntries(new URL(payload).searchParams.entries());
    } catch {
      params = {};
    }

    return { portalUrl: payload, params };
  } catch (error) {
    log.warn("QR decode failed (non-fatal)", {
      ticketId,
      message: error?.message,
    });
    return null;
  }
}

// Best-effort: pull a folio and a numeric total out of the QR query params.
// QR param names vary by merchant, so match a small set of common keys. Never
// throws; returns nulls when nothing usable is present.
function extractQrFields(params) {
  if (!params || typeof params !== "object") {
    return { folio: null, total: null };
  }
  const lower = {};
  for (const [k, v] of Object.entries(params)) lower[k.toLowerCase()] = v;

  const folioRaw =
    lower.folio ?? lower.foliofiscal ?? lower.fol ?? lower.ticket ?? null;
  const folio =
    folioRaw != null && String(folioRaw).trim() ? String(folioRaw).trim() : null;

  const totalRaw = lower.total ?? lower.monto ?? lower.importe ?? lower.tt ?? null;
  let total = null;
  if (totalRaw != null && String(totalRaw).trim()) {
    const n = Number(String(totalRaw).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) total = n;
  }

  return { folio, total };
}

// Persist a decoded QR onto the ticket (mutates the doc; caller saves it):
//   - extracted.portalUrl + extracted.urlSource:"qr" — the authoritative portal so
//     the engine can skip discovery. Stored on `extracted`, NOT `invoice`.
//   - best-effort backfill of folio/total onto extracted ONLY when the QR carries
//     them and the parse didn't (never overwrites a value OCR already extracted).
// No-op when qr is null.
function applyQrToTicket(ticket, qr) {
  if (!qr?.portalUrl) return;

  // CRITICAL (#104): write the portal to `extracted`, never `invoice`. Seeding
  // ticket.invoice here would make Mongoose cast the subdoc and apply its default
  // status "queued"; the POST /invoice start-gate ($or:[{invoice:null},
  // {invoice.status:FAILED}]) would then never match and the run could never start —
  // bricking exactly the QR tickets this feature targets. resolve_portal reads the
  // portal from extracted (urlSource === "qr").
  if (!ticket.extracted) ticket.extracted = {};
  ticket.extracted.portalUrl = qr.portalUrl;
  ticket.extracted.urlSource = "qr";

  // Best-effort backfill of folio/total from the QR query params — only fill a
  // gap, never overwrite what the parse already produced.
  const { folio, total } = extractQrFields(qr.params);
  if (folio != null && ticket.extracted.folio == null) {
    ticket.extracted.folio = folio;
  }
  if (total != null && ticket.extracted.total == null) {
    ticket.extracted.total = total;
  }
}

// POST /api/user/tickets/[id]/ocr
// Auth-gated. Runs the two-step pipeline on a previously uploaded ticket:
//   R2 image -> Google Vision OCR -> Haiku parse -> Ticket.{ocrText,extracted}
// On success the ticket flips to status "ocr_done". An unreadable / low-confidence
// receipt returns a 4xx and leaves the ticket at "uploaded" so it can be retried.
export async function POST(request, { params }) {
  try {
    // Gate on the shared NextAuth session (libs/core/auth.js exposes user.id).
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid ticket id" }, { status: 400 });
    }

    await connectMongoose();

    // Scope by userId so one user can never OCR another user's ticket.
    const ticket = await Ticket.findOne({ _id: id, userId });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Step 1: pull the receipt image back from R2 and OCR it.
    const buffer = await getObjectBuffer(ticket.imageKey);

    // The upload endpoint accepts PDFs for tickets, but Vision's
    // documentTextDetection only handles raster image bytes — a PDF would make
    // it throw and surface as an opaque 500. Detect PDFs by their magic header
    // and return a clear 415 instead, leaving status at "uploaded".
    // PDF OCR (via Vision's file API / PDF-to-image) is a follow-up.
    if (isPdf(buffer)) {
      log.warn("Ticket is a PDF — OCR only supports images", {
        ticketId: ticket._id.toString(),
      });
      return NextResponse.json(
        {
          error:
            "PDF tickets are not supported yet — please upload a photo or image of the receipt",
        },
        { status: 415 }
      );
    }

    // Decode any facturación-portal QR printed on the ticket. Many MX tickets
    // carry one whose payload is the portal URL — having it lets the engine skip
    // KnownMerchant/Firecrawl discovery and go straight to the form. Best-effort
    // and non-fatal: a decode failure returns null and never blocks OCR. Decode
    // from the ORIGINAL bytes (pre-enhancement) so the OCR grayscale/sharpen
    // pipeline can't degrade the QR finder pattern.
    const qr = await decodeTicketQr(buffer, ticket._id.toString());

    // Best-effort pre-OCR enhancement (contrast/blur/brightness/resolution).
    // Returns the original bytes unchanged if the image is already good or if
    // Sharp fails — it never blocks OCR.
    const ocrBuffer = await enhanceForOCR(buffer);

    const rawText = await ocrImage(ocrBuffer);

    // Guard: Vision found little or no text — the photo is unreadable. Leave the
    // ticket at "uploaded" so the client can retry with a better image.
    if (!rawText || rawText.trim().length < 10) {
      log.warn("Low-confidence OCR (empty text)", {
        ticketId: ticket._id.toString(),
        textLength: rawText?.length || 0,
      });
      return NextResponse.json(
        { error: "Could not read the receipt — please retry with a clearer image" },
        { status: 422 }
      );
    }

    // Detect the merchant BEFORE parsing so we can (a) steer extraction with this
    // merchant's field hints and (b) backfill the canonical RFC for the engine.
    // Best-effort: a detection failure must NEVER break OCR. We seed the resolver
    // with an RFC regex'd off the ticket (tier-1 fast path) and the raw OCR text
    // (BM25 over the header), so a name like "OXXO Cuauhtémoc" still resolves.
    let resolvedMerchant = null;
    try {
      const rfcGuess = extractRfc(rawText);
      const { merchant, method } = await resolveMerchant({
        rfcEmisor: rfcGuess,
        ocrText: rawText,
      });
      resolvedMerchant = merchant;
      if (merchant) {
        log.info("Merchant resolved at OCR time", {
          ticketId: ticket._id.toString(),
          merchant: merchant.merchantName,
          method,
        });
      }
    } catch (error) {
      log.warn("Merchant detection failed (non-fatal)", {
        ticketId: ticket._id.toString(),
        message: error?.message,
      });
    }

    // Step 2: structure the raw text with Haiku, steered by this merchant's field
    // hints when we have them (otherwise a plain parse — backward compatible).
    const extracted = await parseTicket(
      rawText,
      resolvedMerchant?.fieldHints
        ? { fieldHints: resolvedMerchant.fieldHints, merchant: resolvedMerchant }
        : {}
    );

    // Guard: none of the key fields came through — treat as low-confidence and
    // don't flip status. rfcEmisor is the deterministic merchant key downstream,
    // so a result with no rfcEmisor, total or date is not usable.
    const hasSignal =
      extracted.rfcEmisor != null ||
      extracted.total != null ||
      extracted.date != null;

    if (!hasSignal) {
      log.warn("Low-confidence parse (no key fields)", {
        ticketId: ticket._id.toString(),
      });
      // Persist the raw text so the failed attempt is debuggable, but keep
      // status "uploaded". A decoded QR portal URL is still worth keeping — it
      // survives the retry and lets the engine skip discovery later.
      ticket.ocrText = rawText;
      applyQrToTicket(ticket, qr);
      await ticket.save();
      return NextResponse.json(
        { error: "Could not extract receipt details — please retry with a clearer image" },
        { status: 422 }
      );
    }

    // Backfill the canonical merchant RFC (gap-fill only — never override an RFC the
    // OCR actually read off the ticket) so the engine's resolve_portal is an instant
    // tier-1 cache hit by RFC and the deterministic driver (e.g. OXXO) fires.
    if (resolvedMerchant?.rfcEmisor && extracted.rfcEmisor == null) {
      extracted.rfcEmisor = resolvedMerchant.rfcEmisor;
    }

    ticket.ocrText = rawText;
    ticket.extracted = extracted;
    ticket.status = "ocr_done";
    ticket.error = null;
    // Persist any decoded QR portal URL (+ best-effort folio/total backfill).
    // Runs after extracted is set so the backfill fills only real gaps.
    applyQrToTicket(ticket, qr);
    await ticket.save();

    log.info("Ticket OCR done", {
      ticketId: ticket._id.toString(),
      userId,
    });

    // Auto-chain: kick off the invoice run immediately so upload→OCR→factura is one
    // automatic flow (no manual "Generar factura" click). Best-effort — if the
    // preflight fails (no CSF, no merchant identity) or the enqueue fails, leave the
    // ticket at ocr_done so the user can start it manually from the ticket. Uses the
    // SAME idempotent gate as the manual route, so it can't double-enqueue.
    let invoiceRun = null;
    try {
      const started = await startInvoiceRun({
        ticketId: ticket._id.toString(),
        userId,
      });
      if (started.ok) {
        invoiceRun = { runId: started.runId, status: started.status };
      } else {
        log.info("OCR auto-invoice not started", {
          ticketId: ticket._id.toString(),
          code: started.code,
        });
      }
    } catch (error) {
      log.warn("OCR auto-invoice failed (non-fatal)", {
        ticketId: ticket._id.toString(),
        message: error?.message,
      });
    }

    return NextResponse.json({
      ticketId: ticket._id.toString(),
      status: ticket.status,
      extracted,
      invoiceRun,
    });
  } catch (error) {
    log.error("Ticket OCR failed:", error);
    return NextResponse.json(
      { error: "Failed to process ticket" },
      { status: 500 }
    );
  }
}
