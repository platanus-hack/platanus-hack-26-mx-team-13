import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { wait } from "@trigger.dev/sdk";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { INVOICE_STATUS } from "@/libs/engine/state";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets:invoice:resume" });

// Completes a durable waitpoint — reads the session, then calls Trigger.dev — so
// it must never be prerendered.
export const dynamic = "force-dynamic";

// POST /api/user/tickets/[id]/invoice/resume
// Auth-gated. The "Listo, ya lo resolví" action: when a run is parked at
// awaiting_human (the engine hit a captcha/login/form blocker and the user
// finished it in the live Browserbase session), this completes the Trigger.dev
// waitpoint the run is suspended on. That resumes the durable task, which
// reconnects to the session, distills a recipe, and parks at ready_to_submit.
//
// The engine resumes asynchronously, so this returns immediately (202); the
// dashboard keeps polling GET .../tickets/[id] to reflect the new status.
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

    // The live view can't capture the human's keystrokes cross-origin, so any
    // recordedActions are best-effort: accept an array if the client sends one,
    // otherwise resume with none (distill still works off the run's own state).
    const body = await request.json().catch(() => ({}));
    const recordedActions = Array.isArray(body?.recordedActions)
      ? body.recordedActions
      : [];

    await connectMongoose();

    // Scope by userId so one user can never resume another user's run.
    const ticket = await Ticket.findOne({ _id: id, userId });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Only a run actually parked at awaiting_human has a waitpoint to complete.
    // Any other status means there's nothing to resume (already running, done,
    // failed) — reject rather than firing a stray completion.
    const invoice = ticket.invoice;
    if (!invoice || invoice.status !== INVOICE_STATUS.AWAITING_HUMAN) {
      return NextResponse.json(
        { error: "This invoice run is not waiting for a human to resolve it" },
        { status: 409 }
      );
    }

    const tokenId = invoice.waitpointTokenId;
    if (!tokenId) {
      return NextResponse.json(
        { error: "No resume token is associated with this run" },
        { status: 409 }
      );
    }

    // Complete the waitpoint: the suspended task's `wait.forToken` resolves with
    // this payload and the run continues. Idempotency is provided upstream by the
    // status gate above — once the run resumes it leaves awaiting_human, so a
    // double-click finds a non-awaiting status and is rejected before reaching here.
    await wait.completeToken(tokenId, { recordedActions, resolvedByHuman: true });

    log.info("Resumed awaiting_human invoice run", {
      ticketId: id,
      userId,
      waitpointTokenId: tokenId,
      recordedActions: recordedActions.length,
    });

    return NextResponse.json(
      { ticketId: id, status: invoice.status, resumed: true },
      { status: 202 }
    );
  } catch (error) {
    log.error("Failed to resume invoice run:", error);
    return NextResponse.json(
      { error: "Failed to resume invoice run" },
      { status: 500 }
    );
  }
}
