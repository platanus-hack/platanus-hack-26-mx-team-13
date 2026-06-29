import { tasks } from "@trigger.dev/sdk";
import Ticket from "@/models/Ticket";
import { resolveCompanyForTicket } from "@/libs/engine/resolveCompany";
import { INVOICE_STATUS } from "@/libs/engine/state";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:start-invoice-run" });

// A run may (re)start only when there is no prior run or the last one failed. Every
// other status means a run is already active or completed, so a second start must be
// rejected rather than enqueueing a duplicate.
const RESTARTABLE_STATUSES = [INVOICE_STATUS.FAILED];

/**
 * Shared start-gate for an invoice run, used by BOTH the manual "Generar factura"
 * route (maps the result to HTTP) and the OCR route's auto-chain (best-effort, just
 * logs). Does the preflight (OCR done, merchant identity present, a valid CSF
 * resolves), the atomic idempotent claim (stamp a queued invoice only when none is
 * active), and enqueues the durable `process-invoice` task.
 *
 * The caller MUST have already called connectMongoose().
 *
 * @param {Object} args
 * @param {string} args.ticketId - Ticket _id (already validated by the caller).
 * @param {string} args.userId   - Owner; scopes every query so cross-user is impossible.
 * @returns {Promise<{ok: true, runId: string, status: string}
 *   | {ok: false, code: "not_found"|"not_ready"|"no_merchant"|"no_company"|"already_running"|"enqueue_failed", error: string}>}
 */
export async function startInvoiceRun({ ticketId, userId }) {
  // Scope by userId so one user can never invoice another user's ticket.
  const ticket = await Ticket.findOne({ _id: ticketId, userId });
  if (!ticket) return { ok: false, code: "not_found", error: "Ticket not found" };

  // The engine drives the portal from the parsed receipt, so OCR must be done.
  if (ticket.status !== "ocr_done") {
    return {
      ok: false,
      code: "not_ready",
      error: "Ticket is not ready to invoice — run OCR first",
    };
  }

  // resolve_portal needs SOME merchant identity: the issuing RFC, else the name.
  if (!ticket.extracted?.rfcEmisor && !ticket.extracted?.merchantNameGuess) {
    return {
      ok: false,
      code: "no_merchant",
      error:
        "Ticket has no merchant identity (neither RFC nor name) — cannot resolve a portal to invoice",
    };
  }

  // Preflight the fiscal profile with the SAME resolver the run uses, so this
  // fast-fail matches what the engine would hit deep in the fill step.
  const company = await resolveCompanyForTicket({ ticket, userId });
  if (!company || !company.rfc) {
    return {
      ok: false,
      code: "no_company",
      error:
        "No tienes una constancia de situación fiscal (CSF) válida cargada — súbela antes de facturar.",
    };
  }

  // Atomic claim: stamp a fresh queued invoice, but only when no run is active
  // (invoice null or last run FAILED). A concurrent start finds no matching doc and
  // is rejected — preventing duplicate durable jobs from driving the form twice.
  const claimed = await Ticket.findOneAndUpdate(
    {
      _id: ticketId,
      userId,
      status: "ocr_done",
      $or: [{ invoice: null }, { "invoice.status": { $in: RESTARTABLE_STATUSES } }],
    },
    {
      $set: {
        invoice: {
          status: INVOICE_STATUS.QUEUED,
          ticketId: ticket._id,
          userId,
        },
      },
    },
    { new: true }
  );

  if (!claimed) {
    return {
      ok: false,
      code: "already_running",
      error: "An invoice run is already in progress for this ticket",
    };
  }

  let handle;
  try {
    handle = await tasks.trigger("process-invoice", {
      ticketId: ticket._id.toString(),
    });
  } catch (triggerError) {
    // Enqueue failed after claiming — release the claim (mark failed = restartable)
    // so the user can retry instead of being stuck on a queued run that never started.
    await Ticket.updateOne(
      { _id: ticketId },
      {
        $set: {
          "invoice.status": INVOICE_STATUS.FAILED,
          "invoice.error": "Failed to enqueue invoice run",
        },
      }
    );
    log.error("Failed to enqueue process-invoice", {
      ticketId: ticket._id.toString(),
      error: String(triggerError),
    });
    return { ok: false, code: "enqueue_failed", error: "Failed to enqueue invoice run" };
  }

  log.info("Started invoice run", {
    ticketId: ticket._id.toString(),
    userId,
    runId: handle.id,
  });
  return { ok: true, runId: handle.id, status: INVOICE_STATUS.QUEUED };
}

export default startInvoiceRun;
