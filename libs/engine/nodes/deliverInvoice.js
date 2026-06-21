// deliver_invoice — the deterministic portal-driver path: drive the merchant's
// portal end-to-end, generate the CFDI, collect the PDF + XML, store them in R2,
// and mark the run done with a cfdi descriptor the dashboard surfaces.
//
// Used INSTEAD of reach_form/replay/fill for merchants that have a hand-authored
// driver (see libs/engine/portals). The driver owns the fill→validate→generate
// flow up to the "Descargar PDF / XML" screen; delivery.js collects the files.
//
// Failure routing mirrors the rest of the engine: a ticket the portal won't
// validate, or a generate that never reached the download screen, is
// human-resolvable (FORM_REJECTED / FORM_FILL_FAILED) → the shell hands off to a
// person in the live session. Missing company/ticket data propagates unchanged.

import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { INVOICE_STATUS, INVOICE_METHOD } from "@/libs/engine/state";
import { ENGINE_ERRORS } from "@/libs/engine/errorTypes";
import { engineError } from "@/libs/engine/node";
import { assembleBillingData, redactBillingData } from "@/libs/engine/billingData";
import { reconnectSession, getActivePage } from "@/libs/engine/session";
import { getPortalDriver } from "@/libs/engine/portals";
import { captureInvoiceFiles, deliverInvoiceFiles } from "@/libs/engine/delivery";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:deliver-invoice" });

/**
 * deliver_invoice node — run a merchant's deterministic driver, then collect and
 * store the CFDI.
 *
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { cfdi?: object, detail?: string }>}
 */
export async function deliverInvoice(state) {
  const driver = getPortalDriver(state.rfcEmisor);
  if (!driver) {
    // The shell only routes here when a driver exists; treat a miss as a real bug.
    throw engineError(
      `No portal driver for ${state.rfcEmisor || "unknown RFC"}`,
      ENGINE_ERRORS.UNKNOWN.code
    );
  }
  if (!state.browserbaseSessionId) {
    throw engineError(
      "No live browser session to drive the portal",
      ENGINE_ERRORS.UNKNOWN.code
    );
  }

  await connectMongoose();

  // Values to write: assembled billingData + the ticket's ID de venta (OXXO's gate
  // asks for it; it isn't a generic billing dataKey, so read it off the ticket).
  const billingData = await assembleBillingData(state.ticketId, state.userId);
  const ticket = await Ticket.findById(state.ticketId).select("extracted").lean();
  const data = { ...billingData, venta: ticket?.extracted?.venta ?? null };

  log.info("deliver_invoice: billingData", {
    ticketId: state.ticketId,
    present: redactBillingData(billingData),
    hasVenta: Boolean(data.venta),
  });

  const { stagehand } = await reconnectSession(state.browserbaseSessionId);
  try {
    const page = getActivePage(stagehand);

    const result = await driver(page, data);
    if (result.alreadyInvoiced) {
      // Terminal and NOT human-resolvable: the receipt is already facturado, so
      // there's nothing to generate and a person at the keyboard can't change that.
      // Spanish message — it surfaces to the user on the ticket's failed state.
      throw engineError(
        "Este ticket ya fue facturado en el portal del comercio.",
        ENGINE_ERRORS.ALREADY_INVOICED.code
      );
    }
    if (!result.validated) {
      throw engineError(
        "The portal did not validate the ticket data (date/folio/ID de venta/total)",
        ENGINE_ERRORS.FORM_REJECTED.code
      );
    }
    if (!result.reachedDownload) {
      throw engineError(
        "Invoice generated but the download screen was not reached",
        ENGINE_ERRORS.FORM_FILL_FAILED.code
      );
    }

    const files = await captureInvoiceFiles(page);
    if (!files.pdf && !files.xml) {
      throw engineError(
        "Reached the download screen but could not collect the CFDI files",
        ENGINE_ERRORS.FORM_FILL_FAILED.code
      );
    }

    const cfdi = await deliverInvoiceFiles({
      ticketId: state.ticketId,
      files,
      total: billingData.total,
    });

    return {
      status: INVOICE_STATUS.DONE,
      method: INVOICE_METHOD.RECIPE,
      recipeUsed: true,
      formReached: true,
      cfdi,
      detail: `CFDI delivered${cfdi.uuid ? ` (UUID ${cfdi.uuid})` : ""}: ${[
        cfdi.pdfKey && "PDF",
        cfdi.xmlKey && "XML",
      ]
        .filter(Boolean)
        .join(" + ")}`,
    };
  } finally {
    // Drop the local CDP handle; keepAlive keeps the cloud session for a handoff.
    await stagehand
      .close()
      .catch((err) => log.warn("deliver_invoice: close failed", { error: String(err) }));
  }
}

export default deliverInvoice;
