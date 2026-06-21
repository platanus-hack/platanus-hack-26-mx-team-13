// Seed the KnownMerchant registry (RFC/name → facturación portal).
//
// resolve_portal looks a merchant up by RFC when the ticket carries one, else by
// normalized name (the common case — most tickets don't print the emisor RFC). This
// script pre-loads that registry so the demo merchants resolve INSTANTLY (cache hit)
// instead of paying for a live Firecrawl discovery.
//
// It writes straight to MongoDB with the official driver (no Next "@/" alias, no
// mongoose models) so it runs as a plain one-off. The document shape mirrors
// models/KnownMerchant.js. Idempotent: re-running upserts, never duplicates.
//
// Run (Node 20.6+, reads MONGODB_URI from .env.local):
//   node --env-file=.env.local scripts/seed-merchant.mjs

import { MongoClient } from "mongodb";

// One row per merchant. rfcEmisor is OPTIONAL — when absent, the registry key is
// derived from the normalized name (resolve_portal does the same), so a real ticket
// photo with no RFC still resolves by name (the common case — most MX tickets don't
// print the issuing RFC). Add more merchants here as needed.
//
// The chains below are pre-loaded so the most common MX tickets resolve INSTANTLY
// (cache hit by name) instead of paying for a live Firecrawl discovery. Each
// invoiceUrl is the best-known OFFICIAL facturación portal for that chain. When a
// chain has no confident standalone portal URL it is intentionally OMITTED rather
// than guessed — a wrong URL would poison the shared registry for every later run.
//
// OMITTED for lack of a confident official portal URL:
//   - Farmacias Guadalajara: no dedicated facturación portal/subdomain; facturación
//     lives behind a help page on the main site (farmaciasguadalajara.com), not a
//     direct, stable portal URL we can drive.
const MERCHANTS = [
  {
    merchantName: "Casa de Toño",
    invoiceUrl: "https://restlcdbc.com/genfactura/",
    // rfcEmisor: "TOÑ...",   // fill in if you ever get the real issuing RFC
    notes: "demo platanus — seeded",
  },

  // --- Common MX chains, keyed by name (no RFC on most tickets) ---
  {
    merchantName: "Steren",
    invoiceUrl: "https://facturacion.steren.com.mx/",
    notes: "chain — official facturación portal (dedicated subdomain)",
  },
  {
    merchantName: "OXXO",
    invoiceUrl:
      "https://www4.oxxo.com:9443/facturacionElectronica-web/views/layout/inicio.do",
    notes: "chain — official OXXO retail (tienda) facturación portal",
  },
  {
    merchantName: "Soriana",
    invoiceUrl: "https://www.soriana.com/facturacion-login",
    notes: "chain — official facturación portal",
  },
  {
    merchantName: "Home Depot",
    invoiceUrl: "https://facturacion.homedepot.com.mx/",
    notes: "chain — official facturación portal (dedicated subdomain)",
  },
  {
    merchantName: "Walmart",
    invoiceUrl: "https://facturacion.walmartmexico.com.mx/",
    notes: "chain — official facturación portal (shared Walmart MX system)",
  },
  {
    merchantName: "Costco",
    invoiceUrl: "https://www3.costco.com.mx/facturacion",
    notes: "chain — official facturación portal",
  },
  {
    merchantName: "Chedraui",
    invoiceUrl: "https://www.masfacturaweb.com.mx/chedraui/chedraui_mfw.aspx",
    notes: "chain — official Chedraui portal (hosted on MasFacturaWeb)",
  },
  {
    merchantName: "Sam's Club",
    invoiceUrl: "https://facturacion.walmartmexico.com.mx/",
    notes: "chain — shares the Walmart MX facturación portal/system",
  },
  {
    merchantName: "Office Depot",
    invoiceUrl: "https://facturacion.officedepot.com.mx/",
    notes: "chain — official facturación portal (dedicated subdomain)",
  },
  {
    merchantName: "Farmacias del Ahorro",
    invoiceUrl: "https://fahorro.masfacturaweb.com.mx/creafactura",
    notes: "chain — official Farmacias del Ahorro portal (hosted on MasFacturaWeb)",
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
function merchantKey(m) {
  const rfc = (m.rfcEmisor || "").trim();
  return (rfc || normalizeName(m.merchantName)).toUpperCase();
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
      const res = await col.updateOne(
        { rfcEmisor },
        {
          $set: {
            rfcEmisor,
            merchantName: m.merchantName,
            normalizedName: normalizeName(m.merchantName),
            invoiceUrl: m.invoiceUrl,
            notes: m.notes ?? null,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );
      const action = res.upsertedCount ? "inserted" : "updated";
      console.log(`✓ KnownMerchant ${action}: ${rfcEmisor} → ${m.invoiceUrl}`);
    }

    console.log(`\nDone. Seeded ${MERCHANTS.length} merchant(s).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("✗ Seed failed:", err?.message || err);
  process.exit(1);
});
