import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { getObjectBuffer } from "@/libs/storage/r2";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:tickets:cfdi" });

// Reads the session and streams private CFDI bytes from R2 — never prerender it.
export const dynamic = "force-dynamic";

// What each downloadable CFDI artifact is: which invoice.cfdi key holds its R2
// object, its MIME type, and the download filename extension.
const ARTIFACTS = {
  pdf: { keyField: "pdfKey", nameField: "pdfName", contentType: "application/pdf", ext: "pdf" },
  xml: { keyField: "xmlKey", nameField: "xmlName", contentType: "application/xml", ext: "xml" },
};

// GET /api/user/tickets/[id]/cfdi/[type]  (type = "pdf" | "xml")
// Auth-gated proxy: streams a ticket's delivered CFDI file from private R2,
// scoped strictly to the owning user, as a download (Content-Disposition).
// 404 (not 403) for tickets the caller doesn't own so a foreign id can't be probed.
export async function GET(request, { params }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id, type } = await params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid ticket id" }, { status: 400 });
    }
    const artifact = ARTIFACTS[String(type).toLowerCase()];
    if (!artifact) {
      return NextResponse.json({ error: "Unknown CFDI artifact" }, { status: 400 });
    }

    await connectMongoose();

    // Scope by userId so one user can never read another user's CFDI.
    const ticket = await Ticket.findOne({ _id: id, userId });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const cfdi = ticket.invoice?.cfdi;
    const key = cfdi?.[artifact.keyField];
    if (!key) {
      return NextResponse.json(
        { error: `No ${type.toUpperCase()} available for this ticket` },
        { status: 404 }
      );
    }

    const buffer = await getObjectBuffer(key);
    const filename = cfdi[artifact.nameField] || `factura-${id}.${artifact.ext}`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        // Private: scoped to this user's session; never on a shared/CDN cache.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    log.error("CFDI download failed:", error);
    return NextResponse.json({ error: "Failed to load CFDI file" }, { status: 500 });
  }
}
