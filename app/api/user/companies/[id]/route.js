import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Company from "@/models/Company";
import User from "@/models/User";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:companies:delete" });

// Reads the session and writes MongoDB — never prerender it.
export const dynamic = "force-dynamic";

// DELETE /api/user/companies/[id]
// Auth-gated soft-delete (isActive:false), scoped to the owner. If the deleted
// company was the user's default, the default is cleared so nothing points at an
// inactive empresa.
export async function DELETE(request, { params }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    await connectMongoose();

    const company = await Company.findOneAndUpdate(
      { _id: id, userId, isActive: true },
      { $set: { isActive: false } },
      { new: true }
    );
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // If this was the default empresa, clear it (matches only when it pointed here).
    await User.updateOne(
      { _id: userId, defaultCompanyId: id },
      { $set: { defaultCompanyId: null } }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("Failed to delete company:", error);
    return NextResponse.json(
      { error: "Failed to delete company" },
      { status: 500 }
    );
  }
}
