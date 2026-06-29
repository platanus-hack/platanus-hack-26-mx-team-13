"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClientSilent } from "@/libs/api";
import TicketDetail from "@/components/tickets/TicketDetail";
import { ticketChip, formatTotal } from "@/libs/format/ticket";

// The dashboard is an action surface, not the full list — show only a preview.
const PREVIEW_LIMIT = 5;

/**
 * RecentTickets — compact preview of the user's latest tickets for the dashboard.
 *
 * Reloads on mount and whenever `reloadKey` bumps (e.g. the parent just finished
 * an upload), so a freshly-uploaded ticket appears without a manual hard refresh.
 * Tapping a row opens the shared TicketDetail modal.
 */
export default function RecentTickets({ reloadKey = 0 }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  // The ticket whose detail modal is open (null = closed).
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await apiClientSilent.get(
        `/user/tickets?limit=${PREVIEW_LIMIT}`
      );
      setTickets(data.tickets || []);
    } catch {
      // Keep whatever we already have on a transient fetch error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load only setStates after awaiting the response (the recommended
    // async-callback pattern), so there's no synchronous cascade here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, reloadKey]);

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
    <div className="flex flex-col gap-1.5">
      {loading ? (
        <p className="text-sm py-3" style={{ color: "var(--text-muted)" }}>Cargando...</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm py-3" style={{ color: "var(--text-muted)" }}>
          Aun no tienes tickets. Sube un recibo para comenzar.
        </p>
      ) : (
        tickets.map((t) => {
          const chip = ticketChip(t);
          const e = t.extracted || {};
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t)}
              className="flex items-center gap-3 py-[9px] px-[10px] rounded-lg text-left transition-colors hover:bg-[var(--bg-subtle)]"
            >
              <span
                className="w-10 h-10 rounded-[9px] flex-none overflow-hidden"
                style={{
                  border: "1px solid var(--border-default)",
                  background: "repeating-linear-gradient(135deg, #EEEBE2 0 5px, #F6F4EE 5px 10px)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/user/tickets/${t.id}/image`}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--text-strong)" }}>
                  {e.merchantNameGuess || e.rfcEmisor || "Recibo"}
                </p>
                <p className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>
                  {e.rfcEmisor || "—"}
                </p>
              </div>
              <span className="text-sm font-mono font-semibold" style={{ color: "var(--text-body)" }}>
                {formatTotal(e.total)}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full py-[5px] px-[11px] text-xs font-semibold whitespace-nowrap ${chip.className}`}
              >
                <span className="w-[7px] h-[7px] rounded-full bg-current" />
                {chip.label}
              </span>
            </button>
          );
        })
      )}

      {selected ? (
        <TicketDetail ticket={selected} onClose={() => setSelected(null)} onChange={patchTicket} />
      ) : null}
    </div>
  );
}
