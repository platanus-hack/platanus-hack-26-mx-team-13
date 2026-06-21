// Inspect production invoice runs — the prod-only feedback loop.
//
// Engine runs are tested in prod (dev was too painful). This script is the way to
// see the real state of each run without opening dashboards: it reads ticket.invoice
// (status / method / errorType / portalUrl / stages[]) from Mongo `facturin-prod`,
// then maps each ticket to its Browserbase session (account-level API, by the
// session's userMetadata.ticketId) and pulls what the browser actually navigated.
//
// Read-only. Writes nothing. Same plain-driver style as scripts/seed-merchant.mjs
// (no Next "@/" alias, no mongoose models) so it runs as a one-off.
//
// Run (Node 20.6+, reads MONGODB_URI + BROWSERBASE_* from .env.local):
//   node --env-file=.env.local scripts/inspect-prod.mjs            # last 12 tickets
//   node --env-file=.env.local scripts/inspect-prod.mjs <ticketId> # one ticket, verbose
//   node --env-file=.env.local scripts/inspect-prod.mjs --limit 30

import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const BB_KEY = process.env.BROWSERBASE_API_KEY;
const BB_PROJECT = process.env.BROWSERBASE_PROJECT_ID;

if (!MONGODB_URI) {
  console.error(
    "✗ MONGODB_URI not set. Run: node --env-file=.env.local scripts/inspect-prod.mjs"
  );
  process.exit(1);
}

// --- args ---
const argv = process.argv.slice(2);
const limitFlag = argv.indexOf("--limit");
const limit = limitFlag !== -1 ? Number(argv[limitFlag + 1]) || 12 : 12;
const oneTicketId = argv.find((a) => !a.startsWith("--") && a !== String(limit));

const short = (s, n = 19) => (s ? String(s).slice(0, n) : "-");

// Map a Browserbase session id (or all sessions for a ticket) → nav + status.
async function browserbaseSessionsByTicket() {
  const byTicket = new Map();
  if (!BB_KEY || !BB_PROJECT) return byTicket;
  try {
    const res = await fetch(
      `https://api.browserbase.com/v1/sessions?projectId=${BB_PROJECT}`,
      { headers: { "X-BB-API-Key": BB_KEY } }
    );
    if (!res.ok) return byTicket;
    const sessions = await res.json();
    for (const s of sessions) {
      const tid = s.userMetadata?.ticketId;
      if (!tid) continue;
      if (!byTicket.has(tid)) byTicket.set(tid, []);
      byTicket.get(tid).push(s);
    }
  } catch {
    /* best-effort */
  }
  return byTicket;
}

async function sessionNavUrls(sessionId) {
  if (!BB_KEY) return [];
  try {
    const res = await fetch(
      `https://api.browserbase.com/v1/sessions/${sessionId}/logs`,
      { headers: { "X-BB-API-Key": BB_KEY } }
    );
    if (!res.ok) return [];
    const logs = await res.json();
    const urls = new Set();
    for (const l of logs) {
      const u =
        l?.request?.params?.documentURL ||
        l?.request?.params?.request?.url ||
        null;
      if (u && /^https?:/.test(u)) urls.add(u.split("?")[0]);
    }
    return [...urls];
  } catch {
    return [];
  }
}

function printStages(stages) {
  if (!Array.isArray(stages) || !stages.length) return "  stages: (none)";
  const line = stages
    .map((s) => `${s.stage || "?"}${s.ok ? "✓" : "✗"}`)
    .join(" → ");
  return `  stages: ${line}`;
}

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
await client.connect();
const db = client.db();
console.log(`DB: ${db.databaseName}\n`);

const T = db.collection("tickets");
const query = oneTicketId ? { _id: await coerceId(oneTicketId) } : {};
const docs = await T.find(query).sort({ updatedAt: -1 }).limit(limit).toArray();

// distribution (only in list mode)
if (!oneTicketId) {
  const byStatus = {};
  const byErr = {};
  for (const t of await T.find({}).toArray()) {
    const i = t.invoice || {};
    byStatus[i.status || "(none)"] = (byStatus[i.status || "(none)"] || 0) + 1;
    if (i.errorType) byErr[i.errorType] = (byErr[i.errorType] || 0) + 1;
  }
  console.log("by invoice.status:", JSON.stringify(byStatus));
  console.log("by errorType:    ", JSON.stringify(byErr), "\n");
}

const bbByTicket = await browserbaseSessionsByTicket();

console.log(`=== ${docs.length} ticket(s) ===`);
for (const t of docs) {
  const i = t.invoice || {};
  const e = t.extracted || {};
  const id = String(t._id);
  console.log(`\n• ${id}  upd=${short(t.updatedAt)}  ticketStatus=${t.status}`);
  console.log(
    `  extracted: name=${JSON.stringify(e.merchantNameGuess || null)} rfc=${JSON.stringify(
      e.rfcEmisor || null
    )} folio=${e.folio || "-"} total=${e.total || "-"} suc=${e.sucursal || "-"} pv=${e.puntoVenta || "-"}`
  );
  console.log(
    `  invoice: status=${i.status} method=${i.method || "-"} errorType=${i.errorType || "-"} urlSource=${i.urlSource || "-"} recipe=${i.recipeUsed || i.recipeId || "-"} submitSel=${i.submitButtonSelector ? "yes" : "no"}`
  );
  console.log(`  portal: ${i.portalUrl || "-"}`);
  if (i.error) console.log(`  error: ${String(i.error).slice(0, 200)}`);
  console.log(printStages(i.stages));
  if ((i.filledFields || []).length || (i.unfilledFields || []).length) {
    console.log(
      `  filled=${JSON.stringify((i.filledFields || []).slice(0, 10))} unfilled=${JSON.stringify(
        (i.unfilledFields || []).slice(0, 10)
      )}`
    );
  }
  const sessions = bbByTicket.get(id) || [];
  for (const s of sessions) {
    console.log(
      `  bbSession ${s.id} status=${s.status} ${short(s.createdAt)}→${short(s.endedAt)}`
    );
    if (oneTicketId) {
      const urls = await sessionNavUrls(s.id);
      if (urls.length) console.log(`    nav: ${urls.join("  |  ")}`);
    }
  }
}

await client.close();

// Coerce a 24-hex string to ObjectId without importing bson separately.
async function coerceId(s) {
  const { ObjectId } = await import("mongodb");
  return /^[a-f0-9]{24}$/i.test(s) ? new ObjectId(s) : s;
}
