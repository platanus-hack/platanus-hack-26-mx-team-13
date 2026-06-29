import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Company from "@/models/Company";
import User from "@/models/User";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:companies" });

// Reads the session and queries/writes MongoDB — never prerender it.
export const dynamic = "force-dynamic";

// GET /api/user/companies
// Auth-gated. Returns the user's active empresas/constancias (newest first) plus
// the user's defaultCompanyId, so the UI can mark the default and preselect it in
// the upload modal.
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    await connectMongoose();

    const [docs, user] = await Promise.all([
      Company.find({ userId, isActive: { $ne: false } }).sort({ createdAt: -1 }),
      User.findById(userId).select("defaultCompanyId").lean(),
    ]);

    // toJSON plugin → id instead of _id, ISO dates, no __v.
    const companies = docs.map((d) => d.toJSON());
    const defaultCompanyId = user?.defaultCompanyId
      ? String(user.defaultCompanyId)
      : null;

    return NextResponse.json({ companies, defaultCompanyId });
  } catch (error) {
    log.error("Failed to list companies:", error);
    return NextResponse.json(
      { error: "Failed to list companies" },
      { status: 500 }
    );
  }
}

// PATCH /api/user/companies
// Body: { companyId }
// Sets the user's default empresa. Validates the company is owned + active before
// pointing User.defaultCompanyId at it.
export async function PATCH(request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { companyId } = await request.json().catch(() => ({}));
    if (!companyId || !mongoose.isValidObjectId(companyId)) {
      return NextResponse.json(
        { error: "A valid companyId is required" },
        { status: 400 }
      );
    }

    await connectMongoose();

    const company = await Company.findOne({
      _id: companyId,
      userId,
      isActive: { $ne: false },
    })
      .select("_id")
      .lean();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    await User.updateOne(
      { _id: userId },
      { $set: { defaultCompanyId: companyId } }
    );

    return NextResponse.json({ ok: true, defaultCompanyId: String(companyId) });
  } catch (error) {
    log.error("Failed to set default company:", error);
    return NextResponse.json(
      { error: "Failed to set default company" },
      { status: 500 }
    );
  }
}
