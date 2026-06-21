"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import TicketUpload from "@/components/TicketUpload";
import TicketDetail from "@/components/TicketDetail";
import InvoiceProgress from "@/components/InvoiceProgress";
import { formatTotal, formatDate } from "@/components/ticketFormat";

// The dashboard is an action surface, not the full list — show only a preview.
const PREVIEW_LIMIT = 5;

/**
 * TicketsSection — ticket uploader + the list of the user's tickets.
 *
 * The uploader (TicketUpload) runs upload → create Ticket → OCR, then calls
 * `onUploaded`, which refetches the list so the freshly-read ticket appears
 * with its extracted fields and status.
 */
export default function TicketsSection() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  // The ticket whose detail modal is open (null = closed).
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/user/tickets?limit=${PREVIEW_LIMIT}`);
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch {
      // Keep whatever we already have on a transient fetch error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Merge a refreshed ticket (from a live invoice run) back into the list and,
  // if it's the open one, the modal — so the chip and modal stay in sync.
  const patchTicket = useCallback((updated) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t))
    );
    setSelected((cur) =>
      cur && cur.id === updated.id ? { ...cur, ...updated } : cur
    );
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <TicketUpload onUploaded={load} />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Recent tickets
          </h3>
          <Link
            href="/tickets"
            className="shrink-0 text-xs font-medium text-zinc-500 transition-colors hover:text-black dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            View all tickets →
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No tickets yet. Upload a receipt to get started.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[.06] dark:divide-white/[.08]">
            {tickets.map((t) => {
              const e = t.extracted || {};
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <button
                    type="button"
                    onClick={() => setSelected(t)}
                    className="-my-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left transition-colors hover:bg-black/[.03] dark:hover:bg-white/[.04]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- private auth-gated proxy, not optimizable by next/image */}
                    <img
                      src={`/api/user/tickets/${t.id}/image`}
                      alt=""
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded-lg border border-black/[.08] object-cover dark:border-white/[.145]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-black dark:text-zinc-100">
                        {e.merchantNameGuess || e.rfcEmisor || "Receipt"}
                      </p>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {formatTotal(e.total)}
                        {e.date ? ` · ${formatDate(e.date)}` : ""}
                        {e.rfcEmisor ? ` · ${e.rfcEmisor}` : ""}
                      </p>
                    </div>
                  </button>
                  <div className="shrink-0">
                    <InvoiceProgress ticket={t} compact onChange={patchTicket} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected ? (
        <TicketDetail
          ticket={selected}
          onClose={() => setSelected(null)}
          onChange={patchTicket}
        />
      ) : null}
    </div>
  );
}
