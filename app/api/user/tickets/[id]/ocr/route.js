import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { getObjectBuffer } from "@/libs/storage/r2";
import { ocrImage } from "@/libs/ocr/googleVision";
import { parseTicket } from "@/libs/ocr/parseTicket";
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

    const rawText = await ocrImage(buffer);

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

    // Step 2: structure the raw text with Haiku.
    const extracted = await parseTicket(rawText);

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
      // status "uploaded".
      ticket.ocrText = rawText;
      await ticket.save();
      return NextResponse.json(
        { error: "Could not extract receipt details — please retry with a clearer image" },
        { status: 422 }
      );
    }

    ticket.ocrText = rawText;
    ticket.extracted = extracted;
    ticket.status = "ocr_done";
    ticket.error = null;
    await ticket.save();

    log.info("Ticket OCR done", {
      ticketId: ticket._id.toString(),
      userId,
    });

    return NextResponse.json({
      ticketId: ticket._id.toString(),
      status: ticket.status,
      extracted,
    });
  } catch (error) {
    log.error("Ticket OCR failed:", error);
    return NextResponse.json(
      { error: "Failed to process ticket" },
      { status: 500 }
    );
  }
}
