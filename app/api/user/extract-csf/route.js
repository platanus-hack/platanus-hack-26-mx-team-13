import { NextResponse } from "next/server";
import { auth } from "@/libs/core/auth";
import { getObjectBuffer } from "@/libs/storage/r2";
import { processCSFPDF } from "@/libs/csf/csf-parser";
import connectMongoose from "@/libs/core/mongoose";
import Company from "@/models/Company";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:extract-csf" });

// Reads from R2 and parses a PDF at call time — never prerender it.
export const dynamic = "force-dynamic";

// POST /api/user/extract-csf
// Body: { key }
// Reads the CSF PDF from R2 by key (uploaded via the presigned PUT flow),
// extracts the fiscal profile deterministically, persists it as the user's
// Company (the engine's billingData source), and returns the saved profile.
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

    // Persist the fiscal profile. The unique {userId, rfc} index means a
    // re-upload of the same RFC updates the existing Company instead of
    // duplicating it; a different RFC creates a new one.
    let company;
    try {
      await connectMongoose();
      company = await Company.findOneAndUpdate(
        { userId, rfc: data.rfc },
        {
          $set: {
            userId,
            rfc: data.rfc,
            curp: data.curp,
            businessName: data.businessName,
            tradeName: data.tradeName,
            taxRegime: data.taxRegime,
            registryStatus: data.registryStatus,
            operationsStartDate: data.operationsStartDate,
            fiscalAddress: data.fiscalAddress,
            csfPdfUrl: key,
            // Uploading a CSF (re)activates the company: a re-upload of an RFC
            // that was previously soft-deleted must come back as active, and the
            // $set must not leave a stale isActive:false on the matched doc.
            isActive: true,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
          runValidators: true,
        }
      );
      log.info("Company upserted from CSF", {
        companyId: company._id.toString(),
        userId,
        rfc: company.rfc,
      });
    } catch (error) {
      log.error("Failed to save Company from CSF:", error);
      return NextResponse.json(
        { error: "Could not save your fiscal profile" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ...data, company });
  } catch (error) {
    log.error("Unexpected error extracting CSF:", error);
    return NextResponse.json(
      { error: "Failed to extract CSF" },
      { status: 500 }
    );
  }
}
