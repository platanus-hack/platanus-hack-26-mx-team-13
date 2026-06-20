import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { tasks } from "@trigger.dev/sdk";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { INVOICE_STATUS } from "@/libs/engine/state";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets:invoice" });

// Reads the session and enqueues a Trigger.dev run — never prerender it.
export const dynamic = "force-dynamic";

// POST /api/user/tickets/[id]/invoice
// Auth-gated. The "Generar factura" trigger: enqueues the durable `process-invoice`
// task for a ticket. Returns immediately with the run id (202) — the engine runs
// asynchronously on Trigger.dev and streams progress onto ticket.invoice.
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

    // Scope by userId so one user can never invoice another user's ticket.
    const ticket = await Ticket.findOne({ _id: id, userId });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // The engine drives the merchant portal from the parsed receipt (rfcEmisor),
    // so the ticket must have completed OCR first.
    if (ticket.status !== "ocr_done") {
      return NextResponse.json(
        { error: "Ticket is not ready to invoice — run OCR first" },
        { status: 409 }
      );
    }

    const handle = await tasks.trigger("process-invoice", {
      ticketId: ticket._id.toString(),
    });

    log.info("Triggered process-invoice", {
      ticketId: ticket._id.toString(),
      userId,
      runId: handle.id,
    });

    return NextResponse.json(
      {
        ticketId: ticket._id.toString(),
        runId: handle.id,
        status: INVOICE_STATUS.QUEUED,
      },
      { status: 202 }
    );
  } catch (error) {
    log.error("Failed to trigger invoice run:", error);
    return NextResponse.json(
      { error: "Failed to start invoice run" },
      { status: 500 }
    );
  }
}
