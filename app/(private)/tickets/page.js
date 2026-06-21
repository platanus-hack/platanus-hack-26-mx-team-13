import TicketsView from "@/components/tickets/TicketsView";

// The (private) layout already gates auth; this page just renders the client
// table, which fetches tickets from GET /api/user/tickets. Nothing here reads
// the session directly, but keep it dynamic to stay consistent with the rest
// of the authenticated surface.
export const dynamic = "force-dynamic";

// /tickets — the ticket "inbox": a filterable, paginated table of every ticket
// the user has uploaded, separate from the dashboard's upload/action surface.
export default function TicketsPage() {
  return <TicketsView />;
}
