"use client";

import { useCallback, useEffect, useState } from "react";
import TicketUpload from "@/components/TicketUpload";

// Visual status chips. The Ticket model uses: uploaded | ocr_done | failed.
const STATUS = {
  uploaded: {
    label: "Uploaded",
    className:
      "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  ocr_done: {
    label: "Read",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
};

const mxn = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function formatTotal(total) {
  if (total == null) return "—";
  try {
    return mxn.format(total);
  } catch {
    return String(total);
  }
}

function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("es-MX");
}

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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/user/tickets");
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

  return (
    <div className="flex flex-col gap-5">
      <TicketUpload onUploaded={load} />

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Your tickets
        </h3>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No tickets yet. Upload a receipt to get started.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[.06] dark:divide-white/[.08]">
            {tickets.map((t) => {
              const status = STATUS[t.status] || STATUS.uploaded;
              const e = t.extracted || {};
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-black dark:text-zinc-100">
                      {e.merchantNameGuess || e.rfcEmisor || "Receipt"}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {formatTotal(e.total)}
                      {e.date ? ` · ${formatDate(e.date)}` : ""}
                      {e.rfcEmisor ? ` · ${e.rfcEmisor}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
                  >
                    {status.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
