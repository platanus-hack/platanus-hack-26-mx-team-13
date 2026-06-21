import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { tasks } from "@trigger.dev/sdk";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import Company from "@/models/Company";
import { INVOICE_STATUS } from "@/libs/engine/state";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets:invoice" });

// A run may (re)start only when there is no prior run or the last one failed.
// Every other invoice status — queued / in-progress / awaiting_human /
// ready_to_submit / done — means a run is already active or completed, so a
// second request must be rejected rather than enqueueing a duplicate.
const RESTARTABLE_STATUSES = [INVOICE_STATUS.FAILED];

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

    // resolve_portal needs SOME merchant identity to find a portal: the issuing RFC
    // when the ticket prints it, else the merchant NAME — the common case, since most
    // tickets don't carry the emisor RFC and resolve_portal matches by name then.
    // Only reject when BOTH are missing (the one case guaranteed to fail with NO_URL);
    // requiring the RFC here desynced this gate from resolve_portal and silently
    // blocked every RFC-less ticket (e.g. Steren) before the run could even start.
    if (!ticket.extracted?.rfcEmisor && !ticket.extracted?.merchantNameGuess) {
      return NextResponse.json(
        {
          error:
            "Ticket has no merchant identity (neither RFC nor name) — cannot resolve a portal to invoice",
        },
        { status: 422 }
      );
    }

    // Preflight the user's fiscal profile BEFORE claiming the ticket and opening
    // an expensive billing Browserbase session. The fill step assembles billingData
    // from Company.findOne({ userId, isActive: true }) (most recent first) and throws
    // the non-human-resolvable MISSING_COMPANY_DATA deep in the run when there is no
    // Company or it lacks an RFC. Mirror that lookup here and fail fast with a clear,
    // user-actionable 422 instead.
    const company = await Company.findOne({ userId, isActive: true })
      .sort({ createdAt: -1 })
      .lean();
    if (!company || !company.rfc) {
      return NextResponse.json(
        {
          error:
            "No tienes una constancia de situación fiscal (CSF) válida cargada — súbela antes de facturar.",
        },
        { status: 422 }
      );
    }

    // Idempotent start: atomically claim the ticket by stamping a fresh queued
    // invoice, but only when no run is active (invoice is null or the last run
    // FAILED). A concurrent double-click / retry finds no matching doc and is
    // rejected below — preventing duplicate durable jobs from racing on
    // ticket.invoice and driving / submitting the merchant form more than once.
    const claimed = await Ticket.findOneAndUpdate(
      {
        _id: id,
        userId,
        status: "ocr_done",
        $or: [
          { invoice: null },
          { "invoice.status": { $in: RESTARTABLE_STATUSES } },
        ],
      },
      {
        $set: {
          invoice: {
            status: INVOICE_STATUS.QUEUED,
            ticketId: ticket._id,
            userId,
          },
        },
      },
      { new: true }
    );

    if (!claimed) {
      return NextResponse.json(
        { error: "An invoice run is already in progress for this ticket" },
        { status: 409 }
      );
    }

    let handle;
    try {
      handle = await tasks.trigger("process-invoice", {
        ticketId: ticket._id.toString(),
      });
    } catch (triggerError) {
      // Enqueue failed after we claimed the ticket — release the claim (mark it
      // failed, which is restartable) so the user can retry instead of being
      // stuck on a queued run that never started.
      await Ticket.updateOne(
        { _id: id },
        {
          $set: {
            "invoice.status": INVOICE_STATUS.FAILED,
            "invoice.error": "Failed to enqueue invoice run",
          },
        }
      );
      throw triggerError;
    }

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
