import { NextResponse } from "next/server";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets" });

// This route reads the session and writes to MongoDB — never prerender it.
export const dynamic = "force-dynamic";

// GET /api/user/tickets
// Returns the current user's tickets, newest first, for the dashboard list.
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    await connectMongoose();

    const docs = await Ticket.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50);

    // toJSON plugin → id instead of _id, ISO dates, no __v.
    const tickets = docs.map((d) => d.toJSON());

    return NextResponse.json({ tickets });
  } catch (error) {
    log.error("Failed to list tickets:", error);
    return NextResponse.json(
      { error: "Failed to list tickets" },
      { status: 500 }
    );
  }
}

// POST /api/user/tickets
// Body: { imageKey }
// Records a freshly uploaded receipt: the client has already PUT the image to R2
// (via /api/user/generate-upload-token with kind "ticket"), so here we just
// persist a Ticket (status "uploaded") pointing at that R2 object and return its id.
// OCR/engine processing is out of scope here (#15).
export async function POST(request) {
  try {
    // Gate on the shared NextAuth session (libs/core/auth.js exposes user.id).
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { imageKey } = await request.json().catch(() => ({}));

    if (!imageKey || typeof imageKey !== "string") {
      return NextResponse.json(
        { error: "imageKey is required" },
        { status: 400 }
      );
    }

    // Defense in depth: the key is minted server-side per user, so it must live
    // under this user's tickets/ prefix. Rejects spoofed or cross-user keys.
    if (!imageKey.startsWith(`tickets/${userId}/`)) {
      return NextResponse.json(
        { error: "imageKey does not belong to this user" },
        { status: 400 }
      );
    }

    await connectMongoose();

    const ticket = await Ticket.create({
      userId,
      imageKey,
      status: "uploaded",
    });

    log.info("Ticket created", {
      ticketId: ticket._id.toString(),
      userId,
    });

    return NextResponse.json({ ticketId: ticket._id.toString() }, { status: 201 });
  } catch (error) {
    log.error("Failed to create ticket:", error);
    return NextResponse.json(
      { error: "Failed to create ticket" },
      { status: 500 }
    );
  }
}
