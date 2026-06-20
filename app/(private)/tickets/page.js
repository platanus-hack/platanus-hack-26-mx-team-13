import Link from "next/link";
import TicketsTable from "@/components/TicketsTable";

// The (private) layout already gates auth; this page just renders the client
// table, which fetches tickets from GET /api/user/tickets. Nothing here reads
// the session directly, but keep it dynamic to stay consistent with the rest
// of the authenticated surface.
export const dynamic = "force-dynamic";

// /tickets — the ticket "inbox": a filterable, paginated table of every ticket
// the user has uploaded, separate from the dashboard's upload/action surface.
export default function TicketsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link
        href="/dashboard"
        className="text-sm text-zinc-500 transition-colors hover:text-black dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← Back to dashboard
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Tickets
      </h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Every receipt you&apos;ve uploaded. Filter by status and load more as
        you go.
      </p>

      <div className="mt-10">
        <TicketsTable />
      </div>
    </div>
  );
}
