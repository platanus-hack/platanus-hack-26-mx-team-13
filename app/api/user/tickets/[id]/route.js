import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets:get" });

// Reads the session and queries MongoDB — never prerender it.
export const dynamic = "force-dynamic";

// GET /api/user/tickets/[id]
// Auth-gated single-ticket read, scoped to the owner. The dashboard polls this
// after a "Generar factura" run is enqueued (POST .../invoice) to reflect live
// engine progress on ticket.invoice — its status and the stages timeline.
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

    // Scope by userId so one user can never read another user's ticket.
    const ticket = await Ticket.findOne({ _id: id, userId });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // toJSON plugin → id instead of _id, ISO dates, no __v.
    return NextResponse.json({ ticket: ticket.toJSON() });
  } catch (error) {
    log.error("Failed to read ticket:", error);
    return NextResponse.json({ error: "Failed to read ticket" }, { status: 500 });
  }
}
