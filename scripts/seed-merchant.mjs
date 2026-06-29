// Seed the KnownMerchant registry (RFC/name → facturación portal + detection aids).
//
// resolve_portal / resolveMerchant look a merchant up by RFC when the ticket carries
// one, else by normalized name / alias, else BM25 ($text) over the registry. This
// script pre-loads that registry (portals, aliases, OCR field hints) so the demo
// merchants resolve INSTANTLY instead of paying for a live Firecrawl discovery, and
// so the deterministic drivers (e.g. OXXO, keyed by its real RFC) actually fire.
//
// It writes straight to MongoDB with the official driver (no Next "@/" alias, no
// mongoose models) so it runs as a plain one-off. The document shape mirrors
// models/KnownMerchant.js. Idempotent: re-running upserts, never duplicates.
//
// Run (Node 20.6+, reads MONGODB_URI from .env.local):
//   node --env-file=.env.local scripts/seed-merchant.mjs

import { MongoClient } from "mongodb";

// One row per merchant. rfcEmisor is OPTIONAL — when absent, the registry key is
// derived from the normalized name (resolveMerchant does the same), so a real ticket
// photo with no RFC still resolves by name/alias/BM25 (the common case — most MX
// tickets don't print the issuing RFC). When a merchant has a deterministic driver
// (libs/engine/portals/*), set its REAL rfcEmisor so the engine selects the driver.
//
// Optional per-merchant fields:
//   aliases    — alternate names/spellings the OCR may yield (branch suffixes, etc.).
//                Stored normalized; powers findByName alias match + the $text search.
//   fieldHints — { important[], notes } that steer OCR extraction for this merchant.
//
// OMITTED for lack of a confident official portal URL:
//   - Farmacias Guadalajara: no dedicated facturación portal/subdomain.
const MERCHANTS = [
  {
    merchantName: "Casa de Toño",
    invoiceUrl: "https://restlcdbc.com/genfactura/",
    aliases: ["Casa de Tono", "Casa de Toño"],
    notes: "demo platanus — seeded",
  },

  // --- Common MX chains ---
  {
    merchantName: "OXXO",
    // Real issuing RFC of Cadena Comercial OXXO — REQUIRED so resolve_portal
    // canonicalizes to it and the deterministic OXXO driver (libs/engine/portals/
    // oxxo.js, keyed by this RFC) actually fires. Without it the driver never ran.
    rfcEmisor: "CCO8605231N4",
    invoiceUrl:
      "https://www4.oxxo.com:9443/facturacionElectronica-web/views/layout/inicio.do",
    aliases: ["OXXO", "OXXO Tienda", "Cadena Comercial OXXO"],
    fieldHints: {
      important: [
        "Fecha de venta",
        "Folio de venta (Fol_Vta)",
        "ID de venta (ID=...)",
        "Total de compra con 2 decimales",
      ],
      notes:
        "OXXO tickets print 'Fol_Vta:' (folio de venta, numeric) and 'ID=' (ID de venta, alphanumeric — distinct from the folio). Total has 2 decimals. Date is DD/MM/YYYY.",
    },
    notes: "chain — official OXXO retail (tienda) facturación portal + deterministic driver",
  },
  {
    merchantName: "Steren",
    invoiceUrl: "https://facturacion.steren.com.mx/",
    aliases: ["Steren"],
    notes: "chain — official facturación portal (dedicated subdomain)",
  },
  {
    merchantName: "Soriana",
    invoiceUrl: "https://www.soriana.com/facturacion-login",
    aliases: ["Soriana", "Soriana Hiper", "Soriana Super"],
    notes: "chain — official facturación portal",
  },
  {
    merchantName: "Home Depot",
    invoiceUrl: "https://facturacion.homedepot.com.mx/",
    aliases: ["Home Depot", "HomeDepot", "Home Depot Mexico"],
    notes: "chain — official facturación portal (dedicated subdomain)",
  },
  {
    merchantName: "Walmart",
    invoiceUrl: "https://facturacion.walmartmexico.com.mx/",
    aliases: ["Walmart", "Walmart Mexico", "Walmart Supercenter"],
    notes: "chain — official facturación portal (shared Walmart MX system)",
  },
  {
    merchantName: "Costco",
    invoiceUrl: "https://www3.costco.com.mx/facturacion",
    aliases: ["Costco", "Costco Wholesale", "Costco Mexico"],
    notes: "chain — official facturación portal",
  },
  {
    merchantName: "Chedraui",
    invoiceUrl: "https://www.masfacturaweb.com.mx/chedraui/chedraui_mfw.aspx",
    aliases: ["Chedraui", "Tiendas Chedraui"],
    notes: "chain — official Chedraui portal (hosted on MasFacturaWeb)",
  },
  {
    merchantName: "Sam's Club",
    invoiceUrl: "https://facturacion.walmartmexico.com.mx/",
    aliases: ["Sams Club", "Sams", "Sam s Club"],
    notes: "chain — shares the Walmart MX facturación portal/system",
  },
  {
    merchantName: "Office Depot",
    invoiceUrl: "https://facturacion.officedepot.com.mx/",
    aliases: ["Office Depot", "OfficeDepot"],
    notes: "chain — official facturación portal (dedicated subdomain)",
  },
  {
    merchantName: "Farmacias del Ahorro",
    invoiceUrl: "https://fahorro.masfacturaweb.com.mx/creafactura",
    aliases: ["Farmacias del Ahorro", "Farmacia del Ahorro", "FAhorro"],
    notes: "chain — official Farmacias del Ahorro portal (hosted on MasFacturaWeb)",
  },
];

/**
 * Mirror of libs/text/normalizeName.js normalizeName (KEEP IN LOCKSTEP): the raw
 * `node` runner can't import the app's ESM `.js` (package.json has no
 * "type":"module"), so the logic is duplicated here. Output MUST match the app's or
 * stored normalizedName / aliases won't match at lookup time.
 */
function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable registry key: the RFC when present, else the normalized name uppercased. */
function merchantKey(m) {
  const rfc = (m.rfcEmisor || "").trim();
  return (rfc || normalizeName(m.merchantName)).toUpperCase();
}

/** Normalize + dedupe a merchant's aliases (stored normalized for lookup matching). */
function normalizeAliases(aliases) {
  if (!Array.isArray(aliases)) return [];
  return [...new Set(aliases.map(normalizeName).filter(Boolean))];
}

/** Ensure the single text index exists with our name/weights (drop a conflicting one). */
async function ensureTextIndex(col) {
  const SPEC = { merchantName: "text", aliases: "text", normalizedName: "text" };
  const OPTS = {
    name: "merchant_text",
    weights: { merchantName: 5, aliases: 4, normalizedName: 2 },
  };
  const existing = await col.indexes();
  const textIx = existing.find((ix) => ix.key && ix.key._fts === "text");
  if (textIx && textIx.name !== "merchant_text") {
    console.log(`• dropping conflicting text index: ${textIx.name}`);
    await col.dropIndex(textIx.name);
  }
  await col.createIndex(SPEC, OPTS);
  console.log("✓ text index ensured: merchant_text");
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      "✗ MONGODB_URI is not set. Run with: node --env-file=.env.local scripts/seed-merchant.mjs"
    );
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    // db() with no arg uses the database from the connection string (same as mongoose).
    const col = client.db().collection("knownmerchants");

    for (const m of MERCHANTS) {
      const rfcEmisor = merchantKey(m);
      const now = new Date();
      const set = {
        rfcEmisor,
        merchantName: m.merchantName,
        normalizedName: normalizeName(m.merchantName),
        invoiceUrl: m.invoiceUrl,
        notes: m.notes ?? null,
        aliases: normalizeAliases(m.aliases),
        updatedAt: now,
      };
      if (m.fieldHints) set.fieldHints = m.fieldHints;

      const res = await col.updateOne(
        { rfcEmisor },
        { $set: set, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
      const action = res.upsertedCount ? "inserted" : "updated";
      console.log(`✓ KnownMerchant ${action}: ${rfcEmisor} → ${m.invoiceUrl}`);
    }

    // Cleanup: OXXO used to be keyed by its normalized NAME ("OXXO"); it's now keyed
    // by its real RFC (CCO8605231N4). Remove the stale name-keyed doc so detection
    // doesn't see a duplicate. Safe: no current merchant is keyed "OXXO".
    const stale = await col.deleteOne({ rfcEmisor: "OXXO" });
    if (stale.deletedCount) {
      console.log("• removed stale name-keyed OXXO doc (rfcEmisor: 'OXXO')");
    }

    await ensureTextIndex(col);

    console.log(`\nDone. Seeded ${MERCHANTS.length} merchant(s).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("✗ Seed failed:", err?.message || err);
  process.exit(1);
});
