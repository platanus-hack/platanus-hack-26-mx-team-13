import { NextResponse } from "next/server";
import { auth } from "@/libs/core/auth";
import { getPresignedPutUrl } from "@/libs/storage/r2";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:generate-upload-token" });

// This route signs requests with R2 credentials at call time — never prerender it.
export const dynamic = "force-dynamic";

// Only CSF PDFs are uploaded through this endpoint today.
const ALLOWED_CONTENT_TYPE = "application/pdf";

// POST /api/user/generate-upload-token
// Body: { fileName, contentType }
// Returns a presigned PUT URL the client uses to upload a CSF PDF straight to R2,
// plus the object key the server later reads back.
export async function POST(request) {
  try {
    // Gate on the shared NextAuth session (libs/core/auth.js exposes user.id).
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { fileName, contentType } = await request.json().catch(() => ({}));

    if (!fileName || typeof fileName !== "string") {
      return NextResponse.json(
        { error: "fileName is required" },
        { status: 400 }
      );
    }

    if (contentType !== ALLOWED_CONTENT_TYPE) {
      return NextResponse.json(
        { error: "contentType must be application/pdf" },
        { status: 400 }
      );
    }

    // Sanitize the file name to a safe key segment: keep letters, digits, dot and
    // dash; collapse everything else to underscores. Prevents path traversal and
    // odd characters in the object key.
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const key = `csf/${userId}/${Date.now()}-${sanitizedFileName}`;

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
