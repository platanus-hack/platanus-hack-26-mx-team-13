import { Toaster } from "react-hot-toast";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Company from "@/models/Company";
import DashboardView from "@/components/dashboard/DashboardView";

// Reads the session and queries MongoDB — never prerender it.
export const dynamic = "force-dynamic";

// Authenticated home. The (private) layout already gated access, so `session`
// is guaranteed here. Hosts the CSF upload + saved fiscal profile (#9) and the
// ticket upload (#25).
export default async function DashboardPage() {
  const session = await auth();

  // Surface the user's existing fiscal profile (if any) so returning users see
  // it without re-uploading. Serialize through the toJSON plugin (id, ISO dates)
  // so it can cross the server→client boundary.
  let company = null;
  try {
    await connectMongoose();
    const doc = await Company.findOne({ userId: session.user.id }).sort({
      updatedAt: -1,
    });
    if (doc) company = JSON.parse(JSON.stringify(doc));
  } catch {
    // A profile-load failure shouldn't break the dashboard; the user can still
    // upload, which re-renders the profile on success.
    company = null;
  }

  return (
    <>
      <DashboardView user={session.user} company={company} />
      <Toaster position="bottom-center" />
    </>
  );
}
