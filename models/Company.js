import mongoose from "mongoose";
import toJSON from "./plugins/toJSON.js";

// COMPANY SCHEMA — fiscal profile parsed from the CSF; source of the
// billingData the engine fills into portals.
const companySchema = mongoose.Schema(
  {
    // Owner of the company.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Registro Federal de Contribuyentes.
    rfc: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    // Clave Única de Registro de Población.
    curp: {
      type: String,
      trim: true,
      uppercase: true,
    },

    // Legal/fiscal name (razón social).
    businessName: {
      type: String,
      required: true,
      trim: true,
    },

    // Commercial name (nombre comercial).
    tradeName: {
      type: String,
      trim: true,
    },

    // Tax regime(s) (régimen fiscal) — one or many.
    taxRegime: {
      type: [String],
      default: [],
    },

    // Status in the SAT registry (padrón).
    registryStatus: {
      type: String,
      default: "ACTIVO",
      trim: true,
    },

    // Operations start date (fecha de inicio de operaciones).
    operationsStartDate: {
      type: Date,
    },

    // Full fiscal address (domicilio fiscal).
    fiscalAddress: {
      // Street type (CALLE, PRIVADA, AVENIDA, etc.).
      streetType: {
        type: String,
        trim: true,
      },
      // Street name.
      streetName: {
        type: String,
        trim: true,
      },
      // Exterior number.
      exteriorNumber: {
        type: String,
        trim: true,
      },
      // Interior number.
      interiorNumber: {
        type: String,
        trim: true,
      },
      // Neighborhood (colonia).
      neighborhood: {
        type: String,
        trim: true,
      },
      // Postal code.
      postalCode: {
        type: String,
        trim: true,
      },
      // Locality.
      locality: {
        type: String,
        trim: true,
      },
      // Municipality / territorial demarcation.
      municipality: {
        type: String,
        trim: true,
      },
      // State / federal entity.
      state: {
        type: String,
        trim: true,
      },
      // Country.
      country: {
        type: String,
        default: "México",
        trim: true,
      },
      // Between streets (location reference).
      betweenStreets: {
        type: String,
        trim: true,
      },
    },

    // R2 key/URL of the Constancia de Situación Fiscal PDF.
    csfPdfUrl: {
      type: String,
      trim: true,
    },

    // Company logo URL.
    logoUrl: {
      type: String,
      trim: true,
    },

    // Soft-delete flag.
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// Fast lookups by user.
companySchema.index({ userId: 1 });

// Lookups by RFC.
companySchema.index({ rfc: 1 });

// Prevent duplicate RFC per user.
companySchema.index({ userId: 1, rfc: 1 }, { unique: true });

// Convert mongoose docs to clean JSON (_id -> id, drop __v).
companySchema.plugin(toJSON);

// Hot-reload guard: reuse the compiled model if it already exists.
export default mongoose.models.Company || mongoose.model("Company", companySchema);
