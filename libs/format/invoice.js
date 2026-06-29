// Shared presentation helpers for the invoicing engine state (Ticket.invoice).
// Keeps the status-chip styling, stage labels, and the "is this run still
// moving" predicate in one place so the detail modal and the ticket lists stay
// consistent. Spanish, since the invoicing flow is user-facing for Mexican
// users (matching the "Generar factura" CTAs).

import { INVOICE_STATUS } from "@/libs/engine/state";

// One entry per INVOICE_STATUS. `tone` selects the chip colors below and tells
// the UI whether to animate (progress/attention pulse). Keyed off INVOICE_STATUS
// values so it never drifts from the engine contract.
export const INVOICE_CHIP = {
  [INVOICE_STATUS.QUEUED]: { label: "En cola", tone: "progress" },
  [INVOICE_STATUS.RESOLVING_PORTAL]: { label: "Buscando portal", tone: "progress" },
  [INVOICE_STATUS.NAVIGATING]: { label: "Navegando", tone: "progress" },
  [INVOICE_STATUS.REACHING_FORM]: { label: "Abriendo formulario", tone: "progress" },
  [INVOICE_STATUS.REPLAYING]: { label: "Llenando formulario", tone: "progress" },
  [INVOICE_STATUS.AI_FILLING]: { label: "Llenando formulario", tone: "progress" },
  [INVOICE_STATUS.DISTILLING]: { label: "Guardando receta", tone: "progress" },
  [INVOICE_STATUS.AWAITING_HUMAN]: { label: "Requiere tu ayuda", tone: "attention" },
  [INVOICE_STATUS.READY_TO_SUBMIT]: { label: "Lista para enviar", tone: "ready" },
  [INVOICE_STATUS.DONE]: { label: "Factura generada", tone: "done" },
  [INVOICE_STATUS.FAILED]: { label: "Falló", tone: "failed" },
};

const TONE_CLASS = {
  progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  attention: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  ready: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// Chip descriptor for an invoice status: label + tailwind className + tone.
// Falls back to the raw status for any value not in the map.
export function invoiceChip(status) {
  const chip = INVOICE_CHIP[status] || { label: status || "—", tone: "progress" };
  return {
    label: chip.label,
    tone: chip.tone,
    className: TONE_CLASS[chip.tone] || TONE_CLASS.progress,
  };
}

// Whether a run's status warrants a pulsing chip (it's actively moving, or a
// human is resolving it in the live view).
export function isAnimatedTone(tone) {
  return tone === "progress" || tone === "attention";
}

// Statuses where the run is still progressing on its own — or parked at
// awaiting_human while a person resolves it in the live view, after which the
// engine continues. The UI polls while in one of these. ready_to_submit / done /
// failed are settled (await the user's action or terminal), so polling stops.
const POLLABLE = new Set([
  INVOICE_STATUS.QUEUED,
  INVOICE_STATUS.RESOLVING_PORTAL,
  INVOICE_STATUS.NAVIGATING,
  INVOICE_STATUS.REACHING_FORM,
  INVOICE_STATUS.REPLAYING,
  INVOICE_STATUS.AI_FILLING,
  INVOICE_STATUS.DISTILLING,
  INVOICE_STATUS.AWAITING_HUMAN,
]);

export function isPollableInvoiceStatus(status) {
  return POLLABLE.has(status);
}

// Human label for a stage entry (Ticket.invoice.stages[].stage). Stage names are
// usually INVOICE_STATUS values, so reuse the chip labels; fall back to the raw
// name for anything custom a node records.
export function stageLabel(stage) {
  return INVOICE_CHIP[stage]?.label || stage;
}

// Short time-of-day for a stage's ISO `at` timestamp, used in the timeline.
export function formatStageTime(at) {
  if (!at) return "";
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}
