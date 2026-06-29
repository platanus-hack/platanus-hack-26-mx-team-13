"use client";

import { useEffect } from "react";
import {
  ticketChip,
  formatTotal,
  formatDate,
  formatDateTime,
} from "@/components/ticketFormat";
import { isAnimatedTone } from "@/components/invoiceFormat";
import InvoiceProgress from "@/components/InvoiceProgress";
import { getCfdiUsageName } from "@/data/sat-catalogs";

// Resolve the empresa label from a (possibly populated) ticket.companyId, tolerating
// a populated object, a raw id, or absence.
function empresaLabel(companyId) {
  if (companyId && typeof companyId === "object") {
    return companyId.tradeName || companyId.businessName || companyId.rfc || null;
  }
  return null;
}

// The extracted fields, in display order, with how each value should render.
// Centralizes the key/value panel so labels and formatting stay in one place.
const FIELDS = [
  { key: "merchantNameGuess", label: "Merchant" },
  { key: "rfcEmisor", label: "RFC emisor" },
  { key: "folio", label: "Folio" },
  { key: "total", label: "Total", format: formatTotal },
  { key: "subtotal", label: "Subtotal", format: formatTotal },
  { key: "date", label: "Receipt date", format: formatDate },
];

/**
 * TicketDetail — modal detail view for a single ticket.
 *
 * Shows the full receipt image (via the auth-gated image proxy #50), the
 * extracted fields as a clean key/value panel, the status chip, and the upload
 * timestamp. Leaves a placeholder for the future "Download invoice" action
 * (the CFDI flow). Closes on overlay click or the Escape key.
 *
 * @param {Object} props
 * @param {Object} props.ticket - A ticket from GET /api/user/tickets.
 * @param {() => void} props.onClose - Called to dismiss the modal.
 * @param {(ticket: Object) => void} [props.onChange] - Bubbles up the refreshed
 *   ticket when the invoice run advances, so the list behind the modal stays in sync.
 */
export default function TicketDetail({ ticket, onClose, onChange }) {
  // Close on Escape, and lock background scroll while the modal is open.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (!ticket) return null;

  const chip = ticketChip(ticket);
  const e = ticket.extracted || {};
  const title = e.merchantNameGuess || e.rfcEmisor || "Receipt";
  const empresa = empresaLabel(ticket.companyId);
  const uso = ticket.usoCFDI
    ? `${ticket.usoCFDI} - ${getCfdiUsageName(ticket.usoCFDI) || ""}`.trim()
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ticket detail"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-8"
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        className="relative my-auto w-full max-w-3xl rounded-2xl border border-black/[.08] bg-white shadow-xl dark:border-white/[.145] dark:bg-[#0a0a0a]"
      >
        {/* Header: title + status chip + close button */}
        <div className="flex items-start justify-between gap-3 border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-black dark:text-zinc-50">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Uploaded {formatDateTime(ticket.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${chip.className}`}
            >
              {isAnimatedTone(chip.tone) ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              ) : null}
              {chip.label}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-black/[.04] hover:text-black dark:text-zinc-400 dark:hover:bg-white/[.06] dark:hover:text-zinc-100"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body: full image + extracted fields side by side on wider screens */}
        <div className="grid gap-6 p-6 sm:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-black/[.08] bg-black/[.02] dark:border-white/[.145] dark:bg-white/[.02]">
            {/* eslint-disable-next-line @next/next/no-img-element -- private auth-gated proxy, not optimizable by next/image */}
            <img
              src={`/api/user/tickets/${ticket.id}/image`}
              alt={`Receipt for ${title}`}
              loading="lazy"
              className="h-auto w-full object-contain"
            />
          </div>

          <div className="flex flex-col gap-4">
            <dl className="flex flex-col divide-y divide-black/[.06] dark:divide-white/[.08]">
              {FIELDS.map((field) => {
                const raw = e[field.key];
                const value = field.format ? field.format(raw) : raw;
                return (
                  <div
                    key={field.key}
                    className="flex items-baseline justify-between gap-4 py-2"
                  >
                    <dt className="shrink-0 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {field.label}
                    </dt>
                    <dd className="min-w-0 truncate text-right text-sm font-medium text-black dark:text-zinc-100">
                      {value || "—"}
                    </dd>
                  </div>
                );
              })}
              {/* Empresa + Uso CFDI come from the ticket itself, not extracted. */}
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="shrink-0 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Empresa
                </dt>
                <dd className="min-w-0 truncate text-right text-sm font-medium text-black dark:text-zinc-100">
                  {empresa || "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="shrink-0 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Uso CFDI
                </dt>
                <dd className="min-w-0 truncate text-right text-sm font-medium text-black dark:text-zinc-100">
                  {uso || "—"}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Invoicing engine: "Generar factura", live status + stages, and the
            ready-to-submit / awaiting-human handoffs. */}
        <div className="border-t border-black/[.08] px-6 py-5 dark:border-white/[.145]">
          <InvoiceProgress ticket={ticket} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}
