import { NextResponse } from "next/server";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import mongoose from "mongoose";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets" });

// This route reads the session and writes to MongoDB — never prerender it.
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const ALLOWED_STATUSES = ["uploaded", "ocr_done", "failed"];

// Opaque cursor: base64url-encoded JSON of the last row's createdAt + _id.
// Pairing both fields lets the query tie-break when timestamps collide.
function encodeCursor(doc) {
  const payload = JSON.stringify({
    c: doc.createdAt.toISOString(),
    i: doc._id.toString(),
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeCursor(raw) {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const { c, i } = JSON.parse(json);
    const createdAt = new Date(c);
    if (Number.isNaN(createdAt.getTime()) || !mongoose.isValidObjectId(i)) {
      return null;
    }
    return { createdAt, id: new mongoose.Types.ObjectId(i) };
  } catch {
    return null;
  }
}

// GET /api/user/tickets
// Returns the current user's tickets, newest first, with cursor pagination.
// Query params:
//   ?limit  — page size (default 20, max 50)
//   ?cursor — opaque cursor from a prior page's nextCursor
//   ?status — uploaded | ocr_done | failed (omit = all)
// Response: { tickets, nextCursor } where nextCursor is null on the last page.
export async function GET(request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    const parsedLimit = parseInt(searchParams.get("limit"), 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const status = searchParams.get("status");
    if (status && !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const rawCursor = searchParams.get("cursor");
    let cursor = null;
    if (rawCursor) {
      cursor = decodeCursor(rawCursor);
      if (!cursor) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
    }

    await connectMongoose();

    const query = { userId };
    if (status) {
      query.status = status;
    }
    if (cursor) {
      // Tie-break compound filter: rows strictly "after" the cursor in the
      // { createdAt: -1, _id: -1 } order, so equal timestamps never drop or
      // duplicate a row across pages.
      query.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ];
    }

    // Fetch one extra row to detect whether another page exists.
    const docs = await Ticket.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

    // toJSON plugin → id instead of _id, ISO dates, no __v.
    const tickets = page.map((d) => d.toJSON());

    return NextResponse.json({ tickets, nextCursor });
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
