"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS, formatTotal, formatDate } from "@/components/ticketFormat";

// Status-filter tabs. `value` is the API `?status=` param (null = all statuses).
// Order mirrors the receipt lifecycle: everything → read → just uploaded → failed.
const TABS = [
  { key: "all", label: "All", value: null },
  { key: "ocr_done", label: "Read", value: "ocr_done" },
  { key: "uploaded", label: "Uploaded", value: "uploaded" },
  { key: "failed", label: "Failed", value: "failed" },
];

/**
 * TicketsTable — the ticket "inbox": status-filter tabs over a table of the
 * user's tickets, with cursor-driven "Load more" pagination.
 *
 * Consumes GET /api/user/tickets (#43): `{ tickets, nextCursor }`. Switching a
 * tab re-queries from scratch with `?status=`; "Load more" appends the next
 * page using the prior response's `nextCursor`.
 */
export default function TicketsTable() {
  const [activeTab, setActiveTab] = useState("all");
  const [tickets, setTickets] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  // Tracks the in-flight request so a tab switch (or a new fetch) can cancel the
  // previous one. Without this, a late response from a prior filter could land
  // after the user switched tabs and replace/append rows under the wrong status.
  const abortRef = useRef(null);

  // Fetch a page. `cursor` null = first page of the active tab (replace the
  // list); otherwise append the next page. Reads the tab's status from the
  // TABS table rather than threading it through, so tab + cursor stay in sync.
  const fetchPage = useCallback(
    async (tabKey, cursor) => {
      // Cancel any request still in flight — its response is now stale.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      const isFirstPage = !cursor;
      if (isFirstPage) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(false);

      try {
        const status = TABS.find((t) => t.key === tabKey)?.value;
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (cursor) params.set("cursor", cursor);

        const res = await fetch(`/api/user/tickets?${params.toString()}`, {
          signal,
        });
        if (!res.ok) throw new Error("Request failed");
        const data = await res.json();

        setTickets((prev) =>
          isFirstPage ? data.tickets || [] : [...prev, ...(data.tickets || [])]
        );
        setNextCursor(data.nextCursor || null);
      } catch (err) {
        // A superseded request was aborted — leave state for the live request.
        if (err.name === "AbortError") return;
        setError(true);
        if (isFirstPage) {
          setTickets([]);
          setNextCursor(null);
        }
      } finally {
        // Only the request that's still current may clear the loading flags;
        // an aborted one must not flip them off under the active request.
        if (!signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    []
  );

  // Re-query from scratch whenever the active tab changes (and on mount).
  // The cleanup aborts the in-flight request so its response can't apply to the
  // newly-selected tab.
  useEffect(() => {
    fetchPage(activeTab, null);
    return () => abortRef.current?.abort();
  }, [activeTab, fetchPage]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-black text-white dark:bg-zinc-50 dark:text-black"
                  : "border border-black/[.08] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : error && tickets.length === 0 ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t load tickets. Please try again.
        </p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-zinc-500">No tickets in this view yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-black/[.08] dark:border-white/[.145]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-black/[.08] text-xs uppercase tracking-wide text-zinc-500 dark:border-white/[.145] dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Merchant / RFC</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
              {tickets.map((t) => {
                const status = STATUS[t.status] || STATUS.uploaded;
                const e = t.extracted || {};
                return (
                  <tr key={t.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-black dark:text-zinc-100">
                        {e.merchantNameGuess || e.rfcEmisor || "Receipt"}
                      </p>
                      {e.merchantNameGuess && e.rfcEmisor ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {e.rfcEmisor}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {formatTotal(e.total)}
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {formatDate(e.date) || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor ? (
        <div>
          <button
            type="button"
            onClick={() => fetchPage(activeTab, nextCursor)}
            disabled={loadingMore}
            className="rounded-full border border-black/[.08] px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
