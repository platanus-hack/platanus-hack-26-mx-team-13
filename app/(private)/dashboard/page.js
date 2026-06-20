import { Toaster } from "react-hot-toast";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Company from "@/models/Company";
import CsfSection from "@/components/CsfSection";
import TicketsSection from "@/components/TicketsSection";

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
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Hi, {session.user.name}
      </h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Welcome to Facturín. Upload your CSF and start turning receipts into
        invoices.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <section className="rounded-2xl border border-black/[.08] p-6 dark:border-white/[.145]">
          <h2 className="text-lg font-medium text-black dark:text-zinc-50">
            Upload CSF
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Upload your CSF constancia (PDF) from the SAT.
          </p>
          <div className="mt-4">
            <CsfSection initialCompany={company} />
          </div>
        </section>
        <section className="rounded-2xl border border-black/[.08] p-6 dark:border-white/[.145]">
          <h2 className="text-lg font-medium text-black dark:text-zinc-50">
            Tickets
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Snap a photo of a receipt or upload an image.
          </p>
          <div className="mt-4">
            <TicketsSection />
          </div>
        </section>
      </div>

      <Toaster position="bottom-center" />
    </div>
  );
}
