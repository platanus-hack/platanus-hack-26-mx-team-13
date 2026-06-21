// Shared ticket presentation helpers — status chips + MXN/date formatting.
// Used by both TicketsSection (dashboard) and TicketsTable (/tickets) so the
// chip styling and number/date formatting stay in one place.

import { invoiceChip } from "@/components/invoiceFormat";

// Visual status chips. The Ticket model uses: uploaded | ocr_done | failed.
export const STATUS = {
  uploaded: {
    label: "Subido",
    className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    bgVar: "var(--warm-100)",
    colorVar: "var(--warm-700)",
  },
  ocr_done: {
    label: "Leido",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    bgVar: "var(--info-soft)",
    colorVar: "var(--info-text)",
  },
  failed: {
    label: "Con error",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    bgVar: "var(--danger-soft)",
    colorVar: "var(--danger-text)",
  },
  invoiced: {
    label: "Facturado",
    className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    bgVar: "var(--success-soft)",
    colorVar: "var(--success-text)",
  },
};

// Unified status chip for a ticket — the SINGLE source of truth for "what state
// is this ticket in". When an invoice run exists, the RUN status wins (queued /
// llenando / lista para enviar / factura generada / falló / requiere ayuda); only
// before any run do we show the receipt lifecycle (subido / leído / con error).
//
// Without this, the UI keyed the chip off ticket.status (the OCR lifecycle), so
// every successfully-read ticket showed "Leído" forever — masking runs that were
// in progress, awaiting the user, failed, or already done. Returns the same shape
// as invoiceChip(): { label, tone, className }.
export function ticketChip(ticket) {
  if (ticket?.invoice?.status) {
    return invoiceChip(ticket.invoice.status);
  }
  const s = STATUS[ticket?.status] || STATUS.uploaded;
  return { label: s.label, tone: "settled", className: s.className };
}

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

// Date + time, for timestamps like createdAt where the moment of upload matters.
export function formatDateTime(date) {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}
