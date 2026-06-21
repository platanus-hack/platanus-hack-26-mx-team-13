// Standalone recipe replay tester — drives a recipe on the REAL portal via
// Browserbase/Stagehand, mirroring how replay_recipe resolves selectors, and reports
// per-step OK/FAIL + a final screenshot. Lets us verify a human-recorded recipe is
// followable end-to-end WITHOUT the full Trigger/auth/ticket pipeline.
//
// Run: node --env-file=.env.local scripts/test-replay.mjs <recipe.json> [out.png]

import fs from "fs";

const recipe = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = process.argv[3] || "/tmp/replay.png";

// Dummy fill values per dataKey (tickets we have are invalid anyway — this only
// checks the recipe FOLLOWS the steps + fills the right fields).
const VALUES = {
  folio: "1234567", total: "13.00", subtotal: "11.21", rfc: "XAXX010101000",
  businessName: "PUBLICO EN GENERAL", postalCode: "31125", email: "test@facturin.mx",
  date: "21/06/2026", sucursal: "058", puntoVenta: "16", terminal: "16",
  cfdiUsage: "G03", paymentMethod: "PUE", taxRegime: "616",
};
const val = (k) => (k && VALUES[k] != null ? String(VALUES[k]) : "123456");

const { Stagehand } = await import("@browserbasehq/stagehand");
const sh = new Stagehand({
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  model: process.env.ENGINE_LLM_MODEL || "anthropic/claude-sonnet-4-6",
  disablePino: true,
});
await sh.init();
const ctx = sh.context;
const page = (typeof ctx?.activePage === "function" && ctx.activePage()) || ctx.pages()[0];

console.log(`\n▶ ${recipe.merchantName} — ${recipe.invoiceUrl}`);
await page.goto(recipe.invoiceUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);

// Candidate locators for a recorded selector, best-strategy first (mirrors the
// engine's multi-strategy resolveSelector: id → name → css → xpath → text).
function candidates(sel) {
  const a = sel.attributes || {};
  const c = [];
  if (a.id) c.push(`[id="${a.id}"]`);
  if (a.name) c.push(`[name="${a.name}"]`);
  if (sel.css) c.push(sel.css);
  if (sel.xpath) c.push("xpath=" + sel.xpath);
  return c;
}

let okCount = 0;
for (const step of recipe.steps) {
  let done = false, used = null, err = null;
  for (const sc of candidates(step.selector)) {
    try {
      const loc = page.locator(sc).first();
      if (!(await loc.count())) continue;
      if (step.action === "fill") await loc.fill(val(step.dataKey), { timeout: 6000 });
      else await loc.click({ timeout: 6000 });
      done = true; used = sc; break;
    } catch (e) { err = String(e.message || e).split("\n")[0]; }
  }
  if (done) okCount++;
  const label = step.dataKey || step.description || step.action;
  console.log(`  ${String(step.order).padStart(2)} ${step.action.padEnd(6)} ${String(label).slice(0, 28).padEnd(28)} ${done ? "✓ " + used : "✗ " + (err || "no match")}`);
  await page.waitForTimeout(900);
}

await page.screenshot({ path: out }).catch(() => {});
console.log(`\n${okCount}/${recipe.steps.length} steps followed · screenshot: ${out}`);
await sh.close().catch(() => {});
