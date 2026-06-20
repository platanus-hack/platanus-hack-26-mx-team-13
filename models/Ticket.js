import mongoose from "mongoose";
import toJSON from "./plugins/toJSON.js";

// Structured fields extracted from the receipt by the OCR/parse step.
const extractedSchema = new mongoose.Schema(
  {
    rfcEmisor: { type: String, default: null },
    folio: { type: String, default: null },
    total: { type: Number, default: null },
    subtotal: { type: Number, default: null },
    date: { type: Date, default: null },
    merchantNameGuess: { type: String, default: null },
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
  },
  {
    timestamps: true,
  }
);

ticketSchema.plugin(toJSON);

ticketSchema.index({ userId: 1, createdAt: -1 });
ticketSchema.index({ status: 1 });

export default mongoose.models.Ticket || mongoose.model("Ticket", ticketSchema);
