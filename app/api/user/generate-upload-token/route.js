import { NextResponse } from "next/server";
import { auth } from "@/libs/core/auth";
import { getPresignedPutUrl } from "@/libs/storage/r2";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:generate-upload-token" });

// This route signs requests with R2 credentials at call time — never prerender it.
export const dynamic = "force-dynamic";

// Upload kinds this endpoint can sign. Each kind owns its key prefix and the set
// of content types it accepts:
//   - "csf":    CSF constancia PDFs              -> csf/{userId}/...     (PDF only)
//   - "ticket": receipt photos/scans (#25)       -> tickets/{userId}/... (image/* only)
// Tickets are images only: OCR (Google Vision) operates on raster images, so PDFs
// would be a dead-end. CSF uploads legitimately use PDF and are unchanged.
const UPLOAD_KINDS = {
  csf: {
    prefix: "csf",
    accepts: (contentType) => contentType === "application/pdf",
    rejectMessage: "contentType must be application/pdf",
  },
  ticket: {
    prefix: "tickets",
    accepts: (contentType) => contentType.startsWith("image/"),
    rejectMessage: "contentType must be an image/*",
  },
};

// POST /api/user/generate-upload-token
// Body: { fileName, contentType, kind? }  (kind defaults to "csf" for back-compat)
// Returns a presigned PUT URL the client uses to upload the file straight to R2,
// plus the object key the server later reads back.
export async function POST(request) {
  try {
    // Gate on the shared NextAuth session (libs/core/auth.js exposes user.id).
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const {
      fileName,
      contentType,
      kind = "csf",
    } = await request.json().catch(() => ({}));

    if (!fileName || typeof fileName !== "string") {
      return NextResponse.json(
        { error: "fileName is required" },
        { status: 400 }
      );
    }

    const uploadKind = UPLOAD_KINDS[kind];
    if (!uploadKind) {
      return NextResponse.json(
        { error: `kind must be one of: ${Object.keys(UPLOAD_KINDS).join(", ")}` },
        { status: 400 }
      );
    }

    if (typeof contentType !== "string" || !uploadKind.accepts(contentType)) {
      return NextResponse.json(
        { error: uploadKind.rejectMessage },
        { status: 400 }
      );
    }

    // Sanitize the file name to a safe key segment: keep letters, digits, dot and
    // dash; collapse everything else to underscores. Prevents path traversal and
    // odd characters in the object key.
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const key = `${uploadKind.prefix}/${userId}/${Date.now()}-${sanitizedFileName}`;

    const uploadUrl = await getPresignedPutUrl({ key, contentType });

    return NextResponse.json({ uploadUrl, key });
  } catch (error) {
    log.error("Failed to generate upload token:", error);
    return NextResponse.json(
      { error: "Failed to generate upload URL" },
      { status: 500 }
    );
  }
}
