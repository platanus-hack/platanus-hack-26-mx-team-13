import mongoose from "mongoose";
import toJSON from "./plugins/toJSON.js";
import {
  INVOICE_STATUS,
  INVOICE_STATUS_VALUES,
  INVOICE_METHOD_VALUES,
} from "@/libs/engine/state";
import { ENGINE_ERROR_CODES } from "@/libs/engine/errorTypes";

// Structured fields extracted from the receipt by the OCR/parse step.
const extractedSchema = new mongoose.Schema(
  {
    rfcEmisor: { type: String, default: null },
    folio: { type: String, default: null },
    total: { type: Number, default: null },
    subtotal: { type: Number, default: null },
    date: { type: Date, default: null },
    merchantNameGuess: { type: String, default: null },
    // Ticket-lookup fields most MX portals require before showing the fiscal form.
    sucursal: { type: String, default: null },
    puntoVenta: { type: String, default: null },
    // Forma/método de pago read off the ticket (e.g. EFECTIVO/TARJETA → SAT code).
    // Without this path the strict subdoc strips the OCR value on save (#102).
    paymentMethod: { type: String, default: null },
    // Facturación portal decoded from the ticket's QR (#98). Stored on `extracted`
    // (NOT `invoice`) so it never instantiates an invoice subdoc with the default
    // status "queued", which would block the run start-gate. resolve_portal prefers
    // this URL when urlSource === "qr".
    portalUrl: { type: String, default: null },
    urlSource: { type: String, default: null },
  },
  { _id: false }
);

// One recorded step of the engine run — see libs/engine/state.js (Stage).
const stageSchema = new mongoose.Schema(
  {
    stage: { type: String, required: true },
    ok: { type: Boolean, required: true },
    detail: { type: String, default: null },
    errorType: { type: String, enum: ENGINE_ERROR_CODES, default: null },
    at: { type: String, default: null },
  },
  { _id: false }
);

// Engine state for the invoicing run — mirrors the InvoiceState typedef in
// libs/engine/state.js. Persisted so the dashboard can poll progress. Stays
// null until the engine starts a run for this ticket. The recordedActions /
// filledFields / unfilledFields / screenshots arrays hold loosely-shaped
// objects (see the typedefs); kept as Mixed so nodes can evolve their contents
// without a schema migration.
const invoiceSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: INVOICE_STATUS_VALUES,
      default: INVOICE_STATUS.QUEUED,
    },

    // References / identity
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    merchantName: { type: String, default: null },
    rfcEmisor: { type: String, default: null },

    // Portal resolution
    portalUrl: { type: String, default: null },
    urlSource: { type: String, default: null },

    // Browser session
    browserbaseSessionId: { type: String, default: null },
    connectUrl: { type: String, default: null },

    // Human-in-the-loop handoff (awaiting_human): the interactive live-view page
    // the human drives, and the Trigger.dev waitpoint token the run is suspended
    // on until the resume route completes it.
    liveViewUrl: { type: String, default: null },
    waitpointTokenId: { type: String, default: null },

    // Recipe
    recipeId: { type: String, default: null },
    recipeFound: { type: Boolean, default: false },
    recipeUsed: { type: Boolean, default: false },
    recipeVersion: { type: Number, default: null },

    // How the form was filled
    method: { type: String, enum: INVOICE_METHOD_VALUES, default: null },

    // Form progress
    formReached: { type: Boolean, default: false },
    recordedActions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    filledFields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    unfilledFields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    submitButtonSelector: { type: String, default: null },

    // Audit trail / observability
    stages: { type: [stageSchema], default: [] },
    cost: { type: Number, default: 0 },
    screenshots: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // Failure detail
    error: { type: String, default: null },
    errorType: { type: String, enum: ENGINE_ERROR_CODES, default: null },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    // References
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },

    // Uploaded receipt image (key in Cloudflare R2)
    imageKey: {
      type: String,
      required: true,
    },

    // Lifecycle
    status: {
      type: String,
      enum: ["uploaded", "ocr_done", "failed"],
      default: "uploaded",
    },

    // Raw text returned by Google Cloud Vision
    ocrText: {
      type: String,
      default: null,
    },

    // Parsed/structured result
    extracted: {
      type: extractedSchema,
      default: () => ({}),
    },

    // Failure detail when status is "failed"
    error: {
      type: String,
      default: null,
    },

    // Engine invoicing state (libs/engine/state.js InvoiceState). null until a
    // run starts; the dashboard polls invoice.status for progress.
    invoice: {
      type: invoiceSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ticketSchema.plugin(toJSON);

ticketSchema.index({ userId: 1, createdAt: -1 });
ticketSchema.index({ status: 1 });

export default mongoose.models.Ticket || mongoose.model("Ticket", ticketSchema);
