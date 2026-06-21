// Bulk-seed MerchantRecipes from recorder-snippet output.
//
// The recipe-recorder.snippet.js (run in a human's browser) emits a MerchantRecipe
// JSON per portal. Collect them into ONE JSON file — either an array of recipes, or
// NDJSON (one recipe object per line) — and upsert them all into facturin-prod.
//
// Idempotent: upserts by (rfcEmisor) when present, else (normalizedName). Strips the
// snippet's internal _k bookkeeping. Plain mongodb driver, no Next alias.
//
// Run (Node 22, reads MONGODB_URI from .env.local):
//   node --env-file=.env.local scripts/seed-recipes-bulk.mjs recipes.json
//   node --env-file=.env.local scripts/seed-recipes-bulk.mjs recipes.ndjson

import fs from "fs";
import { MongoClient } from "mongodb";

const file = process.argv[2];
if (!file) { console.error("usage: node --env-file=.env.local scripts/seed-recipes-bulk.mjs <recipes.json|ndjson>"); process.exit(1); }
const uri = process.env.MONGODB_URI;
if (!uri) { console.error("✗ MONGODB_URI not set"); process.exit(1); }

const raw = fs.readFileSync(file, "utf8").trim();
let recipes;
try {
  // Try the whole file as one JSON value first — handles a single object (pretty or
  // minified) AND an array. Only fall back to NDJSON (one object per line) if that fails.
  const parsed = JSON.parse(raw);
  recipes = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  try {
    recipes = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { console.error("✗ could not parse", file, e.message); process.exit(1); }
}

const norm = (s) => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
const cleanStep = (s, i) => ({
  order: s.order ?? i + 1,
  action: s.action,
  selector: s.selector || {},
  dataKey: s.dataKey ?? null,
  staticValue: s.staticValue ?? null,
  waitAfterMs: s.waitAfterMs ?? null,
  waitForSelector: s.waitForSelector ?? null,
  key: s.key ?? null,
  description: s.description ?? null,
});

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 12000 });
await client.connect();
const col = client.db().collection("merchantrecipes");

let ok = 0;
for (const r of recipes) {
  const normalizedName = r.normalizedName || norm(r.merchantName);
  const rfcEmisor = r.rfcEmisor ? String(r.rfcEmisor).trim().toUpperCase() : null;
  if (!normalizedName && !rfcEmisor) { console.warn("skip: no name/rfc", r.merchantName); continue; }
  if (!Array.isArray(r.steps) || !r.steps.length) { console.warn("skip: no steps", r.merchantName); continue; }

  const query = rfcEmisor ? { rfcEmisor } : { normalizedName };
  const doc = {
    merchantName: r.merchantName || null,
    normalizedName,
    rfcEmisor,
    invoiceUrl: r.invoiceUrl || null,
    recordedVia: r.recordedVia || "human",
    isActive: true,
    version: r.version || 1,
    steps: r.steps.map(cleanStep),
    submitButtonSelector: r.submitButtonSelector || null,
    usageCount: 0, successCount: 0, failureCount: 0,
    updatedAt: new Date(),
  };
  // deactivate any prior active recipe for this merchant, then upsert this one active
  await col.updateMany({ ...query, isActive: true }, { $set: { isActive: false } });
  await col.updateOne(query, { $set: doc, $setOnInsert: { createdAt: new Date() } }, { upsert: true });

  // Also upsert the KnownMerchant so resolve_portal finds BOTH the portal URL and
  // (via the same RFC) the recipe. Keyed by rfc when present, else normalizedName.
  if (r.invoiceUrl) {
    const km = client.db().collection("knownmerchants");
    // The model field + unique index is `rfcEmisor` (NOT `rfc`). Only key by it when
    // present (it's unique → a null would collide with other by-name rows); else by name.
    const kmQuery = rfcEmisor ? { rfcEmisor } : { normalizedName };
    const kmSet = { merchantName: r.merchantName || null, normalizedName, invoiceUrl: r.invoiceUrl, updatedAt: new Date() };
    if (rfcEmisor) kmSet.rfcEmisor = rfcEmisor;
    await km.updateOne(kmQuery, { $set: kmSet, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  }
  console.log(`✓ ${r.merchantName || normalizedName} [${rfcEmisor || "by-name"}] — ${doc.steps.length} steps, submit:${doc.submitButtonSelector ? "yes" : "no"}`);
  ok++;
}
console.log(`\nseeded ${ok}/${recipes.length} recipes`);
await client.close();
