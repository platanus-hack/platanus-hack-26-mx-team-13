import { Toaster } from "react-hot-toast";
import { auth } from "@/libs/core/auth";
import TicketUpload from "@/components/TicketUpload";

// Authenticated home. The (private) layout already gated access, so `session`
// is guaranteed here. Hosts the CSF upload slot (#7, wired up later) and the
// ticket upload (#25).
export default async function DashboardPage() {
  const session = await auth();

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
            Coming soon.
          </p>
        </section>
        <section className="rounded-2xl border border-black/[.08] p-6 dark:border-white/[.145]">
          <h2 className="text-lg font-medium text-black dark:text-zinc-50">
            Tickets
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Snap a photo of a receipt or upload an image/PDF.
          </p>
          <div className="mt-4">
            <TicketUpload />
          </div>
        </section>
      </div>

      <Toaster position="bottom-center" />
    </div>
  );
}
