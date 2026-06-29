import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import { startInvoiceRun } from "@/libs/engine/startInvoiceRun";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets:invoice" });

// HTTP status per startInvoiceRun failure code.
const STATUS_BY_CODE = {
  not_found: 404,
  not_ready: 409,
  no_merchant: 422,
  no_company: 422,
  already_running: 409,
  enqueue_failed: 500,
};

// Reads the session and enqueues a Trigger.dev run — never prerender it.
export const dynamic = "force-dynamic";

// POST /api/user/tickets/[id]/invoice
// Auth-gated. The manual "Generar factura" trigger: enqueues the durable
// `process-invoice` task for a ticket through the shared startInvoiceRun gate (the OCR
// route auto-chains the SAME gate, so upload→OCR→factura is automatic; this route
// stays for retries and the explicit button). Returns 202 with the run id — the
// engine runs asynchronously on Trigger.dev and streams progress onto ticket.invoice.
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

    const result = await startInvoiceRun({ ticketId: id, userId });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: STATUS_BY_CODE[result.code] ?? 500 }
      );
    }

    log.info("Triggered process-invoice", {
      ticketId: id,
      userId,
      runId: result.runId,
    });

    return NextResponse.json(
      { ticketId: id, runId: result.runId, status: result.status },
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
