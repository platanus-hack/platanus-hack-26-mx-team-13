import { NextResponse } from "next/server";
import { auth } from "@/libs/core/auth";
import { getObjectBuffer } from "@/libs/storage/r2";
import { processCSFPDF } from "@/libs/csf/csf-parser";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:extract-csf" });

// Reads from R2 and parses a PDF at call time — never prerender it.
export const dynamic = "force-dynamic";

// POST /api/user/extract-csf
// Body: { key }
// Reads the CSF PDF from R2 by key (uploaded via the presigned PUT flow),
// extracts the fiscal profile deterministically, and returns it.
export async function POST(request) {
  try {
    // Gate on the shared NextAuth session.
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { key } = await request.json().catch(() => ({}));

    if (!key || typeof key !== "string") {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    // Only allow reading objects under the caller's own prefix. Upload keys are
    // scoped as `csf/${userId}/...` (see generate-upload-token), so requiring
    // that prefix prevents an authenticated user from reading another user's
    // CSF by submitting their key (IDOR).
    if (!key.startsWith(`csf/${userId}/`)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Read the PDF straight from R2, server-side.
    let pdfBuffer;
    try {
      pdfBuffer = await getObjectBuffer(key);
    } catch (error) {
      log.error("Failed to read CSF from R2:", error);
      return NextResponse.json(
        { error: "Could not read the uploaded file" },
        { status: 404 }
      );
    }

    // Deterministic text-layer parsing. Invalid/non-CSF PDFs throw with a clear
    // message — surface those as 4xx, keep unexpected failures as 5xx.
    let data;
    try {
      data = await processCSFPDF(pdfBuffer);
    } catch (error) {
      log.warn("CSF parsing failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 422 });
    }

    return NextResponse.json(data);
  } catch (error) {
    log.error("Unexpected error extracting CSF:", error);
    return NextResponse.json(
      { error: "Failed to extract CSF" },
      { status: 500 }
    );
  }
}
