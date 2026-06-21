"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ChevronRight, X } from "lucide-react";
import { Button, Badge, FilterTabs } from "@/components/ui";
import { UploadFlow } from "@/components/upload/UploadFlow";
import InvoiceProgress from "@/components/InvoiceProgress";
import { formatTotal, formatDate, formatDateTime } from "@/components/ticketFormat";

// Receipt-lifecycle chips — shown only BEFORE an invoice run exists.
const STATUS_CONFIG = {
  ocr_done: { label: "Leido", tone: "info" },
  uploaded: { label: "Subido", tone: "neutral" },
  failed: { label: "Con error", tone: "danger" },
  invoiced: { label: "Facturado", tone: "success" },
};

// Unified status chip for a ticket: the invoice RUN status wins when a run exists
// (so the list/modal show "Factura generada" / "Falló" / "Generando…" instead of the
// receipt-level "Leido" forever). Returns a Badge-compatible { label, tone }.
function statusFor(ticket) {
  const inv = ticket.invoice;
  if (inv?.status) {
    switch (inv.status) {
      case "done":
        return { label: "Factura generada", tone: "success" };
      case "failed":
        return {
          label: inv.errorType === "ALREADY_INVOICED" ? "Ya facturado" : "Fallo",
          tone: "danger",
        };
      case "ready_to_submit":
        return { label: "Lista para enviar", tone: "info" };
      case "awaiting_human":
        return { label: "Requiere tu ayuda", tone: "warning" };
      default:
        // queued / resolving_portal / navigating / reaching_form / replaying / ...
        return { label: "Generando...", tone: "info" };
    }
  }
  return STATUS_CONFIG[ticket.status] || STATUS_CONFIG.uploaded;
}

function TicketRow({ ticket, onClick }) {
  const config = statusFor(ticket);
  const e = ticket.extracted || {};

  return (
    <div
      className="grid items-center gap-4 py-3 px-5 cursor-pointer transition-colors hover:bg-[var(--bg-subtle)] border-b"
      style={{
        gridTemplateColumns: "56px 1.6fr 1fr 1fr 116px 24px",
        borderColor: "var(--border-subtle)",
      }}
      onClick={() => onClick(ticket)}
    >
      {/* Thumb */}
      <span
        className="w-11 h-11 rounded-[11px] overflow-hidden flex-none"
        style={{
          border: "1px solid var(--border-default)",
          background: "repeating-linear-gradient(135deg, #EEEBE2 0 5px, #F6F4EE 5px 10px)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/user/tickets/${ticket.id}/image`}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
        />
      </span>

      {/* Merchant */}
      <div className="min-w-0">
        <div className="text-[15px] font-semibold truncate" style={{ color: "var(--text-strong)" }}>
          {e.merchantNameGuess || e.rfcEmisor || "Recibo"}
        </div>
        <div className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>
          {e.rfcEmisor || "Sin datos"}
        </div>
      </div>

      {/* Total */}
      <span className="text-[15px] font-mono font-medium" style={{ color: "var(--text-body)" }}>
        {formatTotal(e.total)}
      </span>

      {/* Date */}
      <span className="text-sm" style={{ color: "var(--text-muted)" }}>
        {formatDate(e.date)}
      </span>

      {/* Status */}
      <Badge tone={config.tone} dot>
        {config.label}
      </Badge>

      {/* Chevron */}
      <span className="grid place-items-center" style={{ color: "var(--text-faint)" }}>
        <ChevronRight className="w-4 h-4" strokeWidth={1.9} />
      </span>
    </div>
  );
}

function TicketDetailModal({ ticket, onClose, onChange }) {
  const config = statusFor(ticket);
  // OCR-level failure (unreadable receipt) — distinct from an invoice-run failure,
  // which InvoiceProgress surfaces below the fields.
  const isFailed = ticket.status === "failed";
  const e = ticket.extracted || {};

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-12"
      style={{ background: "rgba(26, 23, 20, 0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-[760px] rounded-[var(--radius-2xl)] overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-xl)",
        }}
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 py-5 px-6"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div>
            <h2
              className="m-0"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: "-0.015em",
                color: "var(--ink)",
              }}
            >
              {e.merchantNameGuess || e.rfcEmisor || "Recibo"}
            </h2>
            <p className="text-[13px] mt-1" style={{ color: "var(--text-faint)" }}>
              Subido {formatDateTime(ticket.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Badge tone={config.tone} size="lg" dot>
              {config.label}
            </Badge>
            <button
              onClick={onClose}
              className="w-[34px] h-[34px] grid place-items-center rounded-lg border cursor-pointer"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border-default)",
                color: "var(--text-muted)",
              }}
            >
              <X className="w-[18px] h-[18px]" strokeWidth={1.9} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="grid md:grid-cols-2 gap-6 p-6">
          {/* Receipt image */}
          <div
            className="grid place-items-center rounded-xl p-6"
            style={{ background: "var(--bg-subtle)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/user/tickets/${ticket.id}/image`}
              alt="Ticket"
              className="max-w-full max-h-[320px] rounded-lg object-contain"
              style={{ boxShadow: "var(--shadow-md)" }}
            />
          </div>

          {/* Fields / Actions */}
          <div className="flex flex-col">
            {!isFailed ? (
              <>
                <div>
                  {[
                    { label: "RFC emisor", value: e.rfcEmisor || "Sin datos", mono: true },
                    { label: "Folio", value: e.folio || "—", mono: true },
                    { label: "Subtotal", value: formatTotal(e.subtotal), mono: true },
                    { label: "Total", value: formatTotal(e.total), mono: true, brand: true },
                    { label: "Fecha del recibo", value: formatDate(e.date) || "—", noBorder: true },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className={`flex justify-between items-baseline gap-3 py-[11px] ${
                        row.noBorder ? "" : "border-b border-[var(--border-subtle)]"
                      }`}
                    >
                      <span
                        className="text-[10px] font-semibold uppercase"
                        style={{ letterSpacing: "0.07em", color: "var(--text-faint)" }}
                      >
                        {row.label}
                      </span>
                      <span
                        className={`text-[15px] font-medium text-right whitespace-nowrap ${row.mono ? "font-mono" : ""}`}
                        style={{ color: row.brand ? "var(--brand)" : "var(--text-strong)" }}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Real engine actions: generate (when read), live status + the
                    read-only browser view while it runs, and the working PDF/XML
                    downloads once the CFDI is collected. Replaces the static mockup
                    buttons that never did anything. */}
                <div className="mt-auto pt-[18px]">
                  <InvoiceProgress ticket={ticket} onChange={onChange} />
                </div>
              </>
            ) : (
              <>
                <div
                  className="rounded-lg p-4 mb-3"
                  style={{ background: "var(--danger-soft)" }}
                >
                  <div className="text-sm font-semibold" style={{ color: "var(--danger-text)" }}>
                    No pudimos leer este recibo
                  </div>
                  <div className="text-[13px] mt-1" style={{ color: "var(--text-muted)" }}>
                    La foto esta borrosa o incompleta. Vuelve a subirla con mejor luz.
                  </div>
                </div>
                <div className="mt-auto pt-[6px]">
                  <Button variant="coral" fullWidth>
                    Volver a subir
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TicketsView() {
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/user/tickets?limit=50");
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch {
      // Keep existing tickets on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Merge a refreshed ticket (from a live invoice run inside the modal) back into
  // the table and the open modal so the row chip + modal stay in sync.
  const patchTicket = useCallback((updated) => {
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
    setSelectedTicket((cur) => (cur && cur.id === updated.id ? { ...cur, ...updated } : cur));
  }, []);

  // Counts
  const counts = {
    all: tickets.length,
    ocr_done: tickets.filter((t) => t.status === "ocr_done").length,
    uploaded: tickets.filter((t) => t.status === "uploaded").length,
    failed: tickets.filter((t) => t.status === "failed").length,
  };

  // Filter
  const filtered = tickets.filter((t) => {
    if (tab !== "all" && t.status !== tab) return false;
    if (search) {
      const q = search.toLowerCase();
      const e = t.extracted || {};
      return (
        (e.merchantNameGuess && e.merchantNameGuess.toLowerCase().includes(q)) ||
        (e.rfcEmisor && e.rfcEmisor.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const tabs = [
    { label: "Todos", value: "all", count: counts.all },
    { label: "Leidos", value: "ocr_done", count: counts.ocr_done },
    { label: "Subidos", value: "uploaded", count: counts.uploaded },
    { label: "Con error", value: "failed", count: counts.failed },
  ];

  return (
    <>
      <div className="max-w-[1040px] mx-auto px-8 py-10">
        {/* Title */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-[22px]">
          <div>
            <h1
              className="m-0"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 34,
                letterSpacing: "-0.02em",
                color: "var(--ink)",
              }}
            >
              Tickets
            </h1>
            <p className="text-base mt-2" style={{ color: "var(--text-muted)" }}>
              Cada recibo que has subido. Filtra por estado.
            </p>
          </div>
          <Button variant="primary" arrow onClick={() => setShowUpload(true)}>
            Subir ticket
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <FilterTabs tabs={tabs} value={tab} onChange={setTab} />
          <div
            className="flex items-center gap-[9px] w-[248px] py-[9px] px-[13px] rounded-lg border"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-default)",
            }}
          >
            <Search className="w-4 h-4 flex-none" style={{ color: "var(--text-faint)" }} strokeWidth={1.9} />
            <input
              type="text"
              placeholder="Buscar comercio o RFC..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 border-none outline-none bg-transparent text-sm"
              style={{ color: "var(--text-strong)", fontFamily: "var(--font-sans)" }}
            />
          </div>
        </div>

        {/* Table */}
        <div
          className="overflow-hidden rounded-xl"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          {/* Header */}
          <div
            className="grid items-center gap-4 py-3 px-5"
            style={{
              gridTemplateColumns: "56px 1.6fr 1fr 1fr 116px 24px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span />
            <span
              className="text-[11px] font-semibold uppercase"
              style={{ letterSpacing: "0.06em", color: "var(--text-faint)" }}
            >
              Comercio / RFC
            </span>
            <span
              className="text-[11px] font-semibold uppercase"
              style={{ letterSpacing: "0.06em", color: "var(--text-faint)" }}
            >
              Total
            </span>
            <span
              className="text-[11px] font-semibold uppercase"
              style={{ letterSpacing: "0.06em", color: "var(--text-faint)" }}
            >
              Fecha
            </span>
            <span
              className="text-[11px] font-semibold uppercase"
              style={{ letterSpacing: "0.06em", color: "var(--text-faint)" }}
            >
              Estado
            </span>
            <span />
          </div>

          {/* Rows */}
          {loading ? (
            <div className="py-12 text-center">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Cargando tickets...
              </p>
            </div>
          ) : filtered.length > 0 ? (
            filtered.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} onClick={setSelectedTicket} />
            ))
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {tickets.length === 0 ? "Aun no tienes tickets. Sube un recibo para comenzar." : "No se encontraron tickets."}
              </p>
            </div>
          )}
        </div>

        {/* Load more */}
        <div className="mt-4">
          <Button variant="secondary" size="sm">
            Cargar mas
          </Button>
        </div>
      </div>

      {/* Detail modal */}
      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onChange={patchTicket}
        />
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadFlow
          onClose={() => {
            setShowUpload(false);
            loadTickets();
          }}
        />
      )}
    </>
  );
}
