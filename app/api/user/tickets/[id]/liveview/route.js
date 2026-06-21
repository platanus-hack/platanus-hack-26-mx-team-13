import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { getLiveViewUrl } from "@/libs/engine/session";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets:liveview" });

// Reads the live Browserbase session — never prerender / cache.
export const dynamic = "force-dynamic";

// GET /api/user/tickets/[id]/liveview
// Returns the interactive live-view URL (Browserbase debuggerFullscreenUrl) for a
// ticket's running invoice session, so the dashboard can EMBED the browser while
// the engine fills the form (the modal renders it read-only). Best-effort: returns
// { url: null } when there's no live session (run not started / already finished),
// rather than erroring — the UI just doesn't show the live panel. Scoped to the
// owning user; 404 for tickets the caller doesn't own.
export async function GET(request, { params }) {
  try {
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

    const ticket = await Ticket.findOne({ _id: id, userId }).select("invoice");
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const sessionId = ticket.invoice?.browserbaseSessionId;
    if (!sessionId) {
      return NextResponse.json({ url: null });
    }

    // The session may have already been released (run finished) — getLiveViewUrl
    // then throws; treat that as "no live view" rather than a 500.
    let url = null;
    try {
      url = await getLiveViewUrl(sessionId);
    } catch (err) {
      log.warn("liveview: session not available", {
        ticketId: id,
        error: String(err?.message || err),
      });
    }

    return NextResponse.json({ url: url || null });
  } catch (error) {
    log.error("Live view lookup failed:", error);
    return NextResponse.json({ error: "Failed to get live view" }, { status: 500 });
  }
}
