"use client";

import { useCallback, useEffect, useState } from "react";
import { INVOICE_STATUS } from "@/libs/engine/state";
import { STATUS as RECEIPT_STATUS } from "@/components/ticketFormat";
import {
  invoiceChip,
  isAnimatedTone,
  isPollableInvoiceStatus,
  stageLabel,
  formatStageTime,
} from "@/components/invoiceFormat";

// How often to poll the ticket while a run is in flight.
const POLL_INTERVAL_MS = 3000;

// The live view (#66) is a human-viewable page; Ticket.invoice.connectUrl is a
// Browserbase CDP endpoint (wss), not browsable. Only surface a clickable live
// view when the persisted URL is actually an http(s) page — otherwise the
// handoff button stays disabled with a "coming soon" hint until #66 lands.
function liveViewUrl(invoice) {
  const u = invoice?.connectUrl;
  return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null;
}

/**
 * InvoiceProgress — surfaces the invoicing engine for a single ticket.
 *
 * Self-contained: seeds from `ticket.invoice`, triggers the run via
 * POST /api/user/tickets/[id]/invoice, then polls GET /api/user/tickets/[id]
 * while the run is active, rendering the live status chip, the stages timeline
 * (detail mode), and the ready-to-submit / awaiting-human handoff CTAs.
 *
 * @param {Object} props
 * @param {Object} props.ticket - A ticket from the tickets API (needs id, status, invoice).
 * @param {boolean} [props.compact] - Compact mode for list rows (chip + small actions, no timeline).
 * @param {(ticket: Object) => void} [props.onChange] - Called with the refreshed ticket so a parent list can stay in sync.
 */
export default function InvoiceProgress({ ticket, compact = false, onChange }) {
  const [invoice, setInvoice] = useState(ticket.invoice || null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  // Re-seed when the row changes to a different ticket (lists reuse this
  // component across rows). Within one ticket, polling owns `invoice` state.
  useEffect(() => {
    setInvoice(ticket.invoice || null);
    setError(null);
  }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/user/tickets/${ticket.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const next = data.ticket;
      if (next?.invoice) {
        setInvoice(next.invoice);
        onChange?.(next);
      }
    } catch {
      // Transient fetch error — keep the last known state and try again.
    }
  }, [ticket.id, onChange]);

  // Poll while the run is moving. Re-runs when the status changes; an immediate
  // refresh on (re)mount makes a freshly-opened modal catch up at once.
  useEffect(() => {
    const status = invoice?.status;
    if (!status || !isPollableInvoiceStatus(status)) return undefined;
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [invoice?.status, refresh]);

  const generate = useCallback(
    async (event) => {
      event?.stopPropagation?.();
      setStarting(true);
      setError(null);
      try {
        const res = await fetch(`/api/user/tickets/${ticket.id}/invoice`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "No se pudo iniciar la factura");
          return;
        }
        // Optimistically show a queued run; polling fills in stages + status.
        const optimistic = {
          status: data.status || INVOICE_STATUS.QUEUED,
          stages: [],
          connectUrl: null,
        };
        setInvoice(optimistic);
        onChange?.({ ...ticket, invoice: optimistic });
      } catch {
        setError("No se pudo iniciar la factura");
      } finally {
        setStarting(false);
      }
    },
    [ticket, onChange]
  );

  const sizeClass = compact ? "px-3 py-1 text-xs" : "px-5 py-2 text-sm";
  const genLabel = invoice?.status === INVOICE_STATUS.FAILED ? "Reintentar" : "Generar factura";

  const generateButton = (
    <button
      type="button"
      onClick={generate}
      disabled={starting}
      className={`rounded-full bg-black font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-white ${sizeClass}`}
    >
      {starting ? "Iniciando…" : genLabel}
    </button>
  );

  // A handoff CTA that opens the live view in a new tab when available, else a
  // disabled button (the live view, #66, isn't wired yet).
  function liveViewButton(label, tone) {
    const url = liveViewUrl(invoice);
    const palette =
      tone === "attention"
        ? "bg-amber-500 text-white hover:bg-amber-600"
        : "bg-emerald-600 text-white hover:bg-emerald-700";
    return (
      <button
        type="button"
        disabled={!url}
        onClick={(event) => {
          event.stopPropagation();
          if (url) window.open(url, "_blank", "noopener,noreferrer");
        }}
        className={`rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${palette} ${sizeClass}`}
        title={url ? undefined : "La vista en vivo estará disponible pronto"}
      >
        {label}
      </button>
    );
  }

  function chipFor(status) {
    const chip = invoiceChip(status);
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${chip.className}`}
      >
        {isAnimatedTone(chip.tone) ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        ) : null}
        {chip.label}
      </span>
    );
  }

  // ----- Compact (list rows): a tight right-aligned status/action cluster. -----
  if (compact) {
    if (!invoice) {
      if (ticket.status === "ocr_done") return generateButton;
      const rc = RECEIPT_STATUS[ticket.status] || RECEIPT_STATUS.uploaded;
      return (
        <span
          className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${rc.className}`}
        >
          {rc.label}
        </span>
      );
    }
    return (
      <div className="flex items-center justify-end gap-2">
        {chipFor(invoice.status)}
        {invoice.status === INVOICE_STATUS.AWAITING_HUMAN
          ? liveViewButton("Resolver", "attention")
          : null}
        {invoice.status === INVOICE_STATUS.READY_TO_SUBMIT
          ? liveViewButton("Revisar y enviar", "ready")
          : null}
        {invoice.status === INVOICE_STATUS.FAILED ? generateButton : null}
      </div>
    );
  }

  // ----- Detail (modal): full section with timeline + prominent handoffs. -----
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-black dark:text-zinc-50">
          Factura
        </h3>
        {invoice ? chipFor(invoice.status) : null}
      </div>

      {!invoice ? (
        ticket.status === "ocr_done" ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Genera la factura CFDI automáticamente a partir de este ticket.
            </p>
            {generateButton}
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Este ticket aún no está listo para facturar. Espera a que termine la
            lectura del recibo.
          </p>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {invoice.status === INVOICE_STATUS.AWAITING_HUMAN ? (
            <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-900/20">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                El asistente necesita tu ayuda para continuar.
              </p>
              <div>{liveViewButton("Resolver", "attention")}</div>
              {!liveViewUrl(invoice) ? (
                <p className="text-xs text-amber-700 dark:text-amber-300/80">
                  La vista en vivo estará disponible pronto.
                </p>
              ) : null}
            </div>
          ) : null}

          {invoice.status === INVOICE_STATUS.READY_TO_SUBMIT ? (
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-500/40 dark:bg-emerald-900/20">
              <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
                La factura está lista. Revísala y envíala.
              </p>
              <div>{liveViewButton("Revisar y enviar", "ready")}</div>
              {!liveViewUrl(invoice) ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-300/80">
                  La vista en vivo estará disponible pronto.
                </p>
              ) : null}
            </div>
          ) : null}

          {invoice.status === INVOICE_STATUS.DONE ? (
            <p className="text-sm font-medium text-green-700 dark:text-green-300">
              La factura se generó correctamente.
            </p>
          ) : null}

          {invoice.status === INVOICE_STATUS.FAILED ? (
            <div className="flex flex-col items-start gap-2">
              {invoice.error ? (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {invoice.error}
                </p>
              ) : null}
              {generateButton}
            </div>
          ) : null}

          {/* Stages timeline — the run's ordered audit trail. */}
          {invoice.stages?.length ? (
            <ol className="flex flex-col gap-2">
              {invoice.stages.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className={`mt-px shrink-0 font-semibold ${
                      s.ok
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {s.ok ? "✓" : "✕"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-black dark:text-zinc-100">
                      {stageLabel(s.stage)}
                    </p>
                    {s.detail ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {s.detail}
                      </p>
                    ) : null}
                  </div>
                  {s.at ? (
                    <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                      {formatStageTime(s.at)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : isPollableInvoiceStatus(invoice.status) ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Esperando los primeros pasos…
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
