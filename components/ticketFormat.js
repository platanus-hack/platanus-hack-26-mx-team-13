// Shared ticket presentation helpers — status chips + MXN/date formatting.
// Used by both TicketsSection (dashboard) and TicketsTable (/tickets) so the
// chip styling and number/date formatting stay in one place.

// Visual status chips. The Ticket model uses: uploaded | ocr_done | failed.
export const STATUS = {
  uploaded: {
    label: "Uploaded",
    className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
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

export function formatTotal(total) {
  if (total == null) return "—";
  try {
    return mxn.format(total);
  } catch {
    return String(total);
  }
}

export function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("es-MX");
}
