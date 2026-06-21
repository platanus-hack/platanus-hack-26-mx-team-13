// Seed the MerchantRecipe registry (RFC/name → deterministic replay playbook).
//
// A MerchantRecipe is the zero-AI playbook the engine's replay node executes to
// drive one merchant's CFDI portal: an ordered list of browser steps with
// multi-strategy selectors and a value source per step. resolve_portal loads the
// active recipe for a merchant key; replay_recipe runs the steps verbatim. This
// script lets us hand-author (recordedVia:"human") a recipe captured from a live
// portal and load it without the engine.
//
// It writes straight to MongoDB with the official driver (no Next "@/" alias, no
// mongoose models) so it runs as a plain one-off. The document shape mirrors
// models/MerchantRecipe.js. Idempotent: upserts on (rfcEmisor, version), so
// re-running the same version updates in place and never duplicates.
//
// Run (Node 20.6+, reads MONGODB_URI from .env.local):
//   node --env-file=.env.local scripts/seed-recipe.mjs
//
// ============================================================================
// HARD RULE — staticValue vs dataKey (do NOT break this):
//
//   - dataKey:     for ANYTHING that comes from the USER / their CSF / the ticket.
//                  rfc, businessName/email, postalCode, taxRegime, cfdiUsage,
//                  folio, total, subtotal, date, sucursal, puntoVenta, terminal.
//                  These vary per run; the fill step resolves them from the
//                  assembled billingData (see libs/engine/billingDataKeys.js).
//
//   - staticValue: ONLY for MERCHANT-FIXED CONSTANTS that are the same on every
//                  run — e.g. a navigate URL, or a fixed <select> option the
//                  portal always needs (a hard-coded country, a fixed "tipo de
//                  comprobante", etc.).
//
//   NEVER put user data (rfc/email/folio/total/postalCode/date/...) in a
//   staticValue — that would burn one user's data into every other user's run.
// ============================================================================
//
// SELECTORS: do NOT ship placeholder selectors. The template below is an EXAMPLE
// with obviously-fake selectors so the shape is clear; real entries MUST carry
// selectors captured from the live portal. We deliberately do NOT invent real
// selectors for Alsuper / S-Mart / Casa de Toño here — those are captured
// separately against the live portals.

import { MongoClient } from "mongodb";

// Valid step actions — mirror of models/MerchantRecipe.js STEP_ACTIONS.
// (Kept here only as documentation for whoever fills in a real recipe.)
//   navigate | click | fill | select | wait | waitForNavigation | keypress
//
// Valid dataKeys — mirror of libs/engine/billingDataKeys.js BILLING_DATA_KEYS:
//   rfc, businessName, taxRegime, taxRegimeFormatted, postalCode, cfdiUsage,
//   paymentMethod, email, folio, total, subtotal, date, sucursal, puntoVenta,
//   terminal

// One row per recipe. Each entry mirrors models/MerchantRecipe.js. version is
// 1-based; bump it (and seed a new entry) to roll a new active version. isActive
// should be true for exactly one version per merchant.
const RECIPES = [
  // ==========================================================================
  // TEMPLATE / EXAMPLE — placeholder selectors, NOT a real recipe.
  //
  // FILL real selectors captured from the live portal — do NOT ship placeholder
  // selectors. Copy this block, set the merchant fields, and replace every
  // `__REPLACE_*__` selector with one captured from the actual portal DOM.
  //
  // Leave this template OUT of production seeds (set isActive:false or delete it)
  // — it exists to document the shape, not to be replayed.
  // ==========================================================================
  {
    // Merchant key: the issuing RFC when known, else the normalized name
    // uppercased (resolve_portal derives the same key). For a name-keyed merchant
    // set rfcEmisor to the UPPERCASE normalized name, e.g. "CASA DE TONO".
    rfcEmisor: "EXAMPLE_TEMPLATE_RFC",
    merchantName: "Example Merchant (TEMPLATE — do not ship)",
    normalizedName: "example merchant template do not ship",
    invoiceUrl: "https://factura.example.com/",
    version: 1,
    // TEMPLATE is inactive so it is never picked up by resolve_portal/replay.
    isActive: false,
    // Hand-authored from a live capture → "human" (vs "ai" for distilled).
    recordedVia: "human",

    // Ordered playbook. Each step: { order, action, selector{}, dataKey|staticValue,
    // waitAfterMs?, waitForSelector?, key?, description }.
    steps: [
      {
        order: 1,
        action: "navigate",
        // navigate uses a merchant-FIXED URL → staticValue (NOT user data). OK.
        staticValue: "https://factura.example.com/",
        waitForSelector: "__REPLACE_WITH_REAL_CSS_FOR_FIRST_FORM_FIELD__",
        description: "Open the facturación portal and wait for the form.",
      },
      {
        order: 2,
        action: "fill",
        selector: {
          // Multi-strategy: replay falls back css → xpath → text; self-healing
          // re-matches by attributes. Capture as many as the portal exposes.
          css: "__REPLACE_WITH_REAL_CSS_FOR_RFC_INPUT__",
          xpath: "__REPLACE_WITH_REAL_XPATH_FOR_RFC_INPUT__",
          text: null,
          attributes: {
            id: "__REPLACE_input_id__",
            name: "__REPLACE_input_name__",
            ariaLabel: null,
            placeholder: "__REPLACE_placeholder__",
            type: "text",
          },
        },
        // USER DATA → dataKey (NEVER staticValue).
        dataKey: "rfc",
        description: "Type the receiver RFC.",
      },
      {
        order: 3,
        action: "fill",
        selector: {
          css: "__REPLACE_WITH_REAL_CSS_FOR_FOLIO_INPUT__",
          xpath: null,
          text: null,
          attributes: {
            id: "__REPLACE_folio_id__",
            name: "__REPLACE_folio_name__",
            ariaLabel: null,
            placeholder: null,
            type: "text",
          },
        },
        // Ticket data → dataKey.
        dataKey: "folio",
        description: "Type the ticket folio.",
      },
      {
        order: 4,
        action: "fill",
        selector: {
          css: "__REPLACE_WITH_REAL_CSS_FOR_TOTAL_INPUT__",
          xpath: null,
          text: null,
          attributes: {
            id: "__REPLACE_total_id__",
            name: "__REPLACE_total_name__",
            ariaLabel: null,
            placeholder: null,
            type: "text",
          },
        },
        // Ticket data → dataKey.
        dataKey: "total",
        description: "Type the ticket total.",
      },
      {
        order: 5,
        action: "select",
        selector: {
          css: "__REPLACE_WITH_REAL_CSS_FOR_CFDI_USAGE_SELECT__",
          xpath: null,
          text: null,
          attributes: {
            id: "__REPLACE_cfdiuso_id__",
            name: "__REPLACE_cfdiuso_name__",
            ariaLabel: null,
            placeholder: null,
            type: null,
          },
        },
        // USER choice → dataKey.
        dataKey: "cfdiUsage",
        description: "Pick the CFDI usage from the dropdown.",
      },
      {
        order: 6,
        action: "select",
        selector: {
          css: "__REPLACE_WITH_REAL_CSS_FOR_FIXED_COUNTRY_SELECT__",
          xpath: null,
          text: null,
          attributes: {
            id: "__REPLACE_pais_id__",
            name: "__REPLACE_pais_name__",
            ariaLabel: null,
            placeholder: null,
            type: null,
          },
        },
        // EXAMPLE of a legit staticValue: a merchant-FIXED option the portal
        // always needs (here a hard-coded country). NOT user data → staticValue OK.
        staticValue: "México",
        description: "Set the fixed country option the portal requires.",
      },
    ],

    // Selector of the final submit / "Generar factura" control. LOCATED but
    // NEVER CLICKED on replay (a human confirms the actual submit downstream).
    submitButtonSelector: {
      css: "__REPLACE_WITH_REAL_CSS_FOR_SUBMIT_BUTTON__",
      xpath: null,
      text: "Generar factura",
      attributes: {
        id: "__REPLACE_submit_id__",
        name: null,
        ariaLabel: null,
        placeholder: null,
        type: "submit",
      },
    },
  },
];

/** Mirror of models/KnownMerchant.js normalizeName (and resolvePortal's). */
function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable registry key: the RFC when present, else the normalized name uppercased. */
function merchantKey(r) {
  const rfc = (r.rfcEmisor || "").trim();
  return (rfc || normalizeName(r.merchantName)).toUpperCase();
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      "✗ MONGODB_URI is not set. Run with: node --env-file=.env.local scripts/seed-recipe.mjs"
    );
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    // db() with no arg uses the database from the connection string (same as mongoose).
    const col = client.db().collection("merchantrecipes");

    let seeded = 0;
    for (const r of RECIPES) {
      const rfcEmisor = merchantKey(r);
      const version = r.version ?? 1;
      const now = new Date();

      const res = await col.updateOne(
        // Idempotency key: one document per (merchant, version).
        { rfcEmisor, version },
        {
          $set: {
            rfcEmisor,
            merchantName: r.merchantName ?? null,
            normalizedName:
              r.normalizedName ?? (normalizeName(r.merchantName) || null),
            invoiceUrl: r.invoiceUrl ?? null,
            version,
            isActive: r.isActive ?? true,
            steps: r.steps ?? [],
            submitButtonSelector: r.submitButtonSelector ?? null,
            recordedVia: r.recordedVia ?? "human",
            updatedAt: now,
          },
          $setOnInsert: {
            // Health counters start fresh on first insert.
            usageCount: 0,
            successCount: 0,
            failureCount: 0,
            lastFailureReason: null,
            lastValidatedAt: null,
            createdAt: now,
          },
        },
        { upsert: true }
      );
      const action = res.upsertedCount ? "inserted" : "updated";
      console.log(
        `✓ MerchantRecipe ${action}: ${rfcEmisor} v${version} (${
          r.steps?.length ?? 0
        } steps, isActive=${r.isActive ?? true}) → ${r.invoiceUrl}`
      );
      seeded += 1;
    }

    console.log(`\nDone. Seeded ${seeded} recipe(s).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("✗ Seed failed:", err?.message || err);
  process.exit(1);
});
