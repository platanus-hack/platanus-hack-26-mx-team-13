import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { getObjectBuffer } from "@/libs/storage/r2";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets:image" });

// This route reads the session and streams private bytes back from R2 —
// never prerender it.
export const dynamic = "force-dynamic";

// Map a file extension to its image MIME type. R2 objects are private and the
// GetObject response doesn't carry a reliable Content-Type, so we infer from the
// stored key (which the upload flow controls), then fall back to sniffing the
// magic bytes, then default to JPEG.
const EXT_CONTENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

function contentTypeFromKey(key) {
  const ext = key?.split(".").pop()?.toLowerCase();
  return EXT_CONTENT_TYPES[ext] || null;
}

// Sniff the leading magic bytes when the key extension is missing/unknown.
function contentTypeFromBytes(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  if (buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 // F
  ) {
    return "application/pdf";
  }
  return null;
}

// GET /api/user/tickets/[id]/image
// Auth-gated proxy: streams a ticket's receipt image from private R2 storage,
// scoped strictly to the owning user. The front-end points an <img> at this URL
// instead of juggling presigned-URL expiry. Returns 404 (not 403) for tickets
// the caller doesn't own so a foreign id can't be probed.
export async function GET(request, { params }) {
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

    // Scope by userId so one user can never read another user's image.
    const ticket = await Ticket.findOne({ _id: id, userId });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const buffer = await getObjectBuffer(ticket.imageKey);

    const contentType =
      contentTypeFromKey(ticket.imageKey) ||
      contentTypeFromBytes(buffer) ||
      "image/jpeg";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        // Private: scoped to this user's session, safe to cache in their browser
        // but never on a shared/CDN cache.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    log.error("Ticket image fetch failed:", error);
    return NextResponse.json(
      { error: "Failed to load ticket image" },
      { status: 500 }
    );
  }
}
