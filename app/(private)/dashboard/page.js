import { auth } from "@/libs/core/auth";

// Authenticated home. The (private) layout already gated access, so `session`
// is guaranteed here. Hosts placeholder slots for the CSF upload (#7) and the
// tickets/CFDI list, wired up in later issues.
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
            Coming soon.
          </p>
        </section>
      </div>
    </div>
  );
}
