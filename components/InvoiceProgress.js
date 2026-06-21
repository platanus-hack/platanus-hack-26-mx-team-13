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

// Give up polling after this long on a SINGLE status. The timer resets on every
// status transition, so a healthy run (which keeps moving) never hits it; only a
// run that's stuck — e.g. the Trigger worker died without writing a terminal
// status, leaving the ticket pinned at "queued" — stops here instead of hammering
// the API forever (each poll is a serverless invocation on Vercel).
const MAX_POLL_MS = 6 * 60 * 1000;

// The interactive live view is a human-drivable page (Browserbase
// debuggerFullscreenUrl), persisted on Ticket.invoice.liveViewUrl during an
// awaiting_human handoff. connectUrl is a CDP endpoint (wss), not browsable, so
// we only fall back to it when it happens to be an http(s) page. Returns null
// when there's no embeddable URL yet (the handoff CTA stays disabled).
function liveViewUrl(invoice) {
  const u = invoice?.liveViewUrl || invoice?.connectUrl;
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
  const [resuming, setResuming] = useState(false);
  const [liveDisconnected, setLiveDisconnected] = useState(false);
  const [error, setError] = useState(null);
  // Set when polling gives up (MAX_POLL_MS on one status) so the UI can offer a
  // manual refresh instead of silently freezing. Bumping `pollNonce` re-arms the
  // polling effect (the status itself hasn't changed, so it wouldn't re-run).
  const [pollStalled, setPollStalled] = useState(false);
  const [pollNonce, setPollNonce] = useState(0);
  // Browserbase live-view URL while an automated run is in flight — the modal
  // embeds it READ-ONLY so the user watches the form being filled (demo candy).
  const [runLiveView, setRunLiveView] = useState(null);

  // Re-seed when the row changes to a different ticket (lists reuse this
  // component across rows). Within one ticket, polling owns `invoice` state.
  useEffect(() => {
    setInvoice(ticket.invoice || null);
    setLiveDisconnected(false);
    setError(null);
  }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The embedded Browserbase live view posts `browserbase-disconnected` when its
  // session ends (the human closed it, or the CDP session timed out). Surface
  // that so the user knows to click "Listo" (or the run will time out).
  useEffect(() => {
    function onMessage(event) {
      const data = event?.data;
      if (data === "browserbase-disconnected" || data?.type === "browserbase-disconnected") {
        setLiveDisconnected(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // A fresh handoff clears any stale "disconnected" flag from a previous one.
  useEffect(() => {
    if (invoice?.status === INVOICE_STATUS.AWAITING_HUMAN) setLiveDisconnected(false);
  }, [invoice?.status, invoice?.liveViewUrl]);

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

  // Poll while the run is moving. Re-runs when the status changes (so the
  // MAX_POLL_MS budget resets on every transition); an immediate refresh on
  // (re)mount makes a freshly-opened modal catch up at once. Polling pauses while
  // the tab is hidden and gives up after MAX_POLL_MS on a stuck status — both
  // keep a background or crashed run from spamming the API on Vercel.
  useEffect(() => {
    const status = invoice?.status;
    if (!status || !isPollableInvoiceStatus(status)) return undefined;

    setPollStalled(false);
    const startedAt = Date.now();
    let timer = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const tick = () => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        stop();
        setPollStalled(true);
        return;
      }
      refresh();
    };
    const start = () => {
      if (timer || document.hidden) return;
      refresh();
      timer = setInterval(tick, POLL_INTERVAL_MS);
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [invoice?.status, refresh, pollNonce]);

  // While an automated run is in flight (not awaiting_human — that has its own
  // INTERACTIVE panel), poll the Browserbase live-view URL so the detail modal can
  // embed the browser read-only. Compact list rows don't embed it. The URL appears
  // once the session opens and disappears when the run finishes (session released).
  useEffect(() => {
    const status = invoice?.status;
    const active =
      !compact &&
      status &&
      isPollableInvoiceStatus(status) &&
      status !== INVOICE_STATUS.AWAITING_HUMAN;
    if (!active) {
      setRunLiveView(null);
      return undefined;
    }
    let cancelled = false;
    const fetchUrl = async () => {
      try {
        const res = await fetch(`/api/user/tickets/${ticket.id}/liveview`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRunLiveView(data.url || null);
      } catch {
        // Transient — keep the last URL and retry on the next tick.
      }
    };
    fetchUrl();
    const timer = setInterval(fetchUrl, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [invoice?.status, compact, ticket.id]);

  // Re-arm polling after it stalled (manual "Actualizar").
  const retryPolling = useCallback((event) => {
    event?.stopPropagation?.();
    setPollNonce((n) => n + 1);
  }, []);

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

  // "Listo, ya lo resolví": the user finished the blocker in the live session.
  // Completes the durable waitpoint so the engine resumes; the run leaves
  // awaiting_human asynchronously, so we just keep polling for the new status.
  const resolve = useCallback(
    async (event) => {
      event?.stopPropagation?.();
      setResuming(true);
      setError(null);
      try {
        const res = await fetch(`/api/user/tickets/${ticket.id}/invoice/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordedActions: [] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "No se pudo reanudar la factura");
          return;
        }
        refresh();
      } catch {
        setError("No se pudo reanudar la factura");
      } finally {
        setResuming(false);
      }
    },
    [ticket.id, refresh]
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
  // disabled button. Used in compact list rows (the detail modal embeds the live
  // view inline instead); the ready_to_submit handoff still uses it everywhere.
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

  // Download links for the delivered CFDI (PDF + XML). The files are served from
  // R2 by the auth-gated cfdi route, which sets Content-Disposition so a plain
  // link downloads them. Rendered once the run is done and files are attached.
  function cfdiDownloads() {
    const cfdi = invoice?.cfdi;
    if (!cfdi || (!cfdi.pdfKey && !cfdi.xmlKey)) return null;
    const link = (type, label, palette) => (
      <a
        href={`/api/user/tickets/${ticket.id}/cfdi/${type}`}
        download
        onClick={(event) => event.stopPropagation()}
        className={`rounded-full font-semibold transition-colors ${palette} ${sizeClass}`}
      >
        {label}
      </a>
    );
    return (
      <div className="flex flex-wrap items-center gap-2">
        {cfdi.pdfKey
          ? link("pdf", "Descargar PDF", "bg-red-600 text-white hover:bg-red-700")
          : null}
        {cfdi.xmlKey
          ? link("xml", "Descargar XML", "bg-emerald-600 text-white hover:bg-emerald-700")
          : null}
      </div>
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
        {pollStalled ? (
          <button
            type="button"
            onClick={retryPolling}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Actualizar
          </button>
        ) : null}
        {invoice.status === INVOICE_STATUS.AWAITING_HUMAN
          ? liveViewButton("Resolver", "attention")
          : null}
        {invoice.status === INVOICE_STATUS.READY_TO_SUBMIT
          ? liveViewButton("Revisar y enviar", "ready")
          : null}
        {invoice.status === INVOICE_STATUS.DONE ? cfdiDownloads() : null}
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
        <div className="flex items-center gap-2">
          {pollStalled ? (
            <button
              type="button"
              onClick={retryPolling}
              className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Actualizar
            </button>
          ) : null}
          {invoice ? chipFor(invoice.status) : null}
        </div>
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
            <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-900/20">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                El asistente necesita tu ayuda para continuar. Resuelve el bloqueo
                (captcha, inicio de sesión o el formulario) en la ventana de abajo y
                luego pulsa “Listo”.
              </p>

              {liveViewUrl(invoice) ? (
                <div className="overflow-hidden rounded-lg border border-amber-300 bg-white dark:border-amber-500/40 dark:bg-black">
                  {/* Interactive live view: the human drives the SAME Browserbase
                      session. sandbox allows scripts + same-origin so the embedded
                      debugger works, and there is NO pointer-events:none — the user
                      can actually click and type inside it. */}
                  <iframe
                    src={liveViewUrl(invoice)}
                    title="Vista en vivo del navegador"
                    sandbox="allow-same-origin allow-scripts"
                    allow="clipboard-read; clipboard-write"
                    className="h-[460px] w-full border-0"
                  />
                </div>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-300/80">
                  La vista en vivo estará disponible pronto.
                </p>
              )}

              {liveDisconnected ? (
                <p className="text-xs text-amber-700 dark:text-amber-300/80">
                  La vista en vivo se desconectó. Si ya resolviste el bloqueo, pulsa
                  “Listo”.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={resolve}
                  disabled={resuming}
                  className={`rounded-full bg-emerald-600 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass}`}
                >
                  {resuming ? "Reanudando…" : "Listo, ya lo resolví"}
                </button>
                {liveViewUrl(invoice) ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      window.open(
                        liveViewUrl(invoice),
                        "_blank",
                        "noopener,noreferrer"
                      );
                    }}
                    className={`rounded-full border border-amber-400 font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-500/50 dark:text-amber-200 dark:hover:bg-amber-900/30 ${sizeClass}`}
                  >
                    Abrir en pestaña
                  </button>
                ) : null}
              </div>
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
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-green-700 dark:text-green-300">
                La factura se generó correctamente.
                {invoice.cfdi?.uuid ? (
                  <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-400">
                    UUID {invoice.cfdi.uuid}
                  </span>
                ) : null}
              </p>
              {cfdiDownloads()}
            </div>
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

          {/* Read-only live view: watch the assistant drive the portal while the
              run is in flight. The wrapper swallows pointer events so it's
              view-only (interacting is the awaiting_human panel's job). */}
          {runLiveView && invoice.status !== INVOICE_STATUS.AWAITING_HUMAN ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                El asistente está llenando tu factura — míralo en vivo
              </div>
              <div className="overflow-hidden rounded-lg border border-black/[.08] dark:border-white/[.145]">
                <div style={{ pointerEvents: "none" }}>
                  <iframe
                    src={runLiveView}
                    title="Vista en vivo del navegador"
                    sandbox="allow-same-origin allow-scripts"
                    tabIndex={-1}
                    scrolling="no"
                    className="h-[420px] w-full border-0"
                  />
                </div>
              </div>
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
