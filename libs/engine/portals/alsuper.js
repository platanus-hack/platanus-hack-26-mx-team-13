// Deterministic portal driver — Alsuper (Operadora Futurama, northern-MX grocery).
//
// Authored from a recorded run of https://facturacion.alsuper.com/ (Playwright
// codegen). Unlike OXXO's PrimeFaces SPA, Alsuper's portal is a plain ASP.NET form
// with a simple TWO-step flow:
//
//   Step 1 (home): a lookup form — SUCURSAL (a <select> whose option VALUE is the
//     store/"Tienda" number), FOLIO, PUNTO DE VENTA, FECHA DE EMISIÓN (a native
//     <input type=date>), TOTAL VENTA, plus the receptor R.F.C. and CORREO. Click
//     "Facturar" → the portal validates the ticket and navigates to /Facturacion.
//   Step 2 (/Facturacion): the receptor data (régimen, nombre, CP) is auto-filled
//     from the RFC's SAT registry — only USO CFDI must be chosen. Click "Facturar"
//     to generate, which lands on a screen offering "Guardar" / "Descargar PDF" /
//     "Descargar XML" (libs/engine/delivery.js collects the files).
//
// Mirrors the OXXO driver's contract and the hybrid AI checkpoint: deterministic
// detection first, classifyPortalOutcome() as a fallback when the portal's wording
// is inconclusive (e.g. an "already invoiced" message we didn't anticipate).

import { classifyPortalOutcome } from "@/libs/engine/classifyOutcome";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:portal:alsuper" });

// The merchant key (issuing RFC) this driver handles — Operadora Futurama, S.A. de
// C.V. resolve_portal canonicalizes the Alsuper KnownMerchant to this RFC so the
// engine selects this driver by it.
export const ALSUPER_RFC = "OFU910626UQO";
export const ALSUPER_PORTAL_URL = "https://facturacion.alsuper.com/";

// "Already invoiced" wording (either word order), same family as the OXXO matcher.
const ALREADY_INVOICED_RE =
  /facturad[oa]\s+previamente|previamente\s+facturad[oa]|ya\s.{0,30}facturad[oa]|ticket\s.{0,20}facturad[oa]/i;

// Notes for the AI checkpoint when deterministic detection is inconclusive.
const ALSUPER_OUTCOME_NOTES = [
  "Alsuper portal: after clicking Facturar on the lookup form it validates the ticket and navigates to /Facturacion (the receptor step) → validated.",
  "If the receipt was already invoiced it shows a message modal (e.g. 'ya facturado'/'facturado previamente') and stays on the lookup → already_invoiced (terminal).",
  "Wrong sucursal / folio / punto de venta / fecha / total, or ticket not found → rejected.",
].join(" ");

/** Whole-page innerText, whitespace-collapsed. */
async function bodyText(page) {
  const t = await page.locator("body").first().innerText().catch(() => "");
  return t.replace(/\s+/g, " ");
}

/** Text of the global message modal / any visible dialog (where errors surface). */
async function modalText(page) {
  return page
    .evaluate(() => {
      const m = document.querySelector(
        "#globalMessageModal, .modal.show, [role=dialog]"
      );
      return m ? (m.innerText || "").replace(/\s+/g, " ").trim() : "";
    })
    .catch(() => "");
}

/** Break a Date|ISO|DMY value into YYYY-MM-DD for the native date input. */
function dateYMD(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = /(\d{2})\/(\d{2})\/(\d{2,4})/.exec(value);
    if (dmy) {
      const yr = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
      return `${yr}-${dmy[2]}-${dmy[1]}`;
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Select an <option> in a native <select> WITHOUT page.selectOption — the engine's
 * Stagehand-wrapped page doesn't expose it (only locator/evaluate, like the OXXO
 * driver). We set `.value` and dispatch input+change inside the page so any
 * client-side handler (and the eventual form POST) sees the choice. The picker
 * receives the option list and returns the chosen value, so caller-side logic
 * (number vs name match) runs in Node, not the browser.
 *
 * @param {import("playwright").Page} page
 * @param {string} selector - CSS selector for the <select>.
 * @param {(opts: {value:string,text:string}[]) => string|null} pick - returns the value to select.
 * @returns {Promise<string|null>} the selected value, or null when nothing matched.
 */
async function selectOptionInPage(page, selector, pick) {
  const options = await page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.tagName !== "SELECT") return null;
      return [...el.options].map((o) => ({
        value: o.value,
        text: (o.textContent || "").trim(),
      }));
    }, selector)
    .catch(() => null);
  if (!options || !options.length) return null;

  const value = pick(options);
  if (value == null) return null;

  const ok = await page
    .evaluate(
      ({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === val;
      },
      { sel: selector, val: value }
    )
    .catch(() => false);
  return ok ? value : null;
}

/**
 * Select the SUCURSAL. The option VALUE is the store/"Tienda" number, so prefer the
 * numeric match (robust); fall back to matching the branch NAME (e.g. "BOSQUES")
 * against the option text. `sucursal` may arrive as the tienda number ("058"), the
 * branch name ("BOSQUES"), or the full header ("ALSUPER PLUS BOSQUES").
 */
async function selectSucursal(page, sucursal) {
  const raw = String(sucursal ?? "").trim();
  if (!raw) return false;

  const digits = raw.replace(/\D/g, "");
  const up = raw.toUpperCase();
  const chosen = await selectOptionInPage(page, "#Sucursal", (opts) => {
    // 1) Numeric: tienda number → option value (strip leading zeros).
    if (digits) {
      const want = String(parseInt(digits, 10));
      const byValue = opts.find((o) => o.value === want);
      if (byValue) return byValue.value;
    }
    // 2) Name: an option whose text overlaps the (uppercased) sucursal.
    const byName = opts.find((o) => {
      const t = o.text.toUpperCase();
      return o.value && t && (up.includes(t) || t.includes(up));
    });
    return byName ? byName.value : null;
  });

  if (chosen != null) {
    log.info("Alsuper: sucursal selected", { value: chosen });
    return true;
  }
  log.warn("Alsuper: could not match sucursal", { sucursal: raw });
  return false;
}

/** Fill an input by CSS selector, best-effort. */
async function setField(page, selector, value) {
  if (value == null || value === "") return;
  const loc = page.locator(selector).first();
  await loc.click({ timeout: 4000 }).catch(() => {});
  await loc.fill(String(value), { timeout: 5000 }).catch(() => {});
}

/** Click the first control matching any of the CSS selectors. Returns true if one was clicked. */
async function clickFirst(page, selectors, timeout = 8000) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      const clicked = await loc
        .click({ timeout })
        .then(() => true)
        .catch(() => false);
      if (clicked) return true;
    }
  }
  return false;
}

/**
 * Drive the Alsuper portal end-to-end and leave the page on the download screen.
 *
 * @param {import("playwright").Page} page
 * @param {import("@/libs/engine/billingData").BillingData} data
 * @returns {Promise<{validated:boolean, alreadyInvoiced:boolean, generated:boolean, reachedDownload:boolean}>}
 */
export async function driveAlsuperToDownload(page, data) {
  if (!String(page.url() || "").includes("alsuper.com")) {
    await page.goto(ALSUPER_PORTAL_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  }
  await page.waitForTimeout(2500);

  // --- Step 1: lookup form ---
  await selectSucursal(page, data.sucursal);
  await setField(page, "#Folio", data.folio);
  await setField(page, "#PuntoVenta", data.puntoVenta);
  const ymd = dateYMD(data.date);
  if (ymd) await setField(page, "#FechaEmision", ymd);
  if (data.total != null) await setField(page, "#TotalVenta", Number(data.total));
  if (data.rfc) await setField(page, "#RFCCliente", String(data.rfc).toUpperCase());
  if (data.email) await setField(page, "#CorreoElectronico", data.email);

  await clickFirst(page, [
    "#btnFacturar",
    'button:has-text("Facturar")',
    'input[type=submit]',
  ]);

  // Validation gate: a valid ticket navigates to /Facturacion (the receptor step);
  // an already-invoiced / rejected ticket stays on the lookup with a message modal.
  let validated = false;
  let alreadyInvoiced = false;
  const seen = new Set();
  for (let s = 0; s < 8; s++) {
    await page.waitForTimeout(1500);
    if (String(page.url() || "").includes("/Facturacion")) {
      validated = true;
      break;
    }
    const msg = `${await modalText(page)} ${await bodyText(page)}`;
    if (msg.trim()) seen.add(msg.slice(0, 500));
    if (ALREADY_INVOICED_RE.test(msg)) {
      alreadyInvoiced = true;
      break;
    }
  }

  // Hybrid AI checkpoint — deterministic first, model as fallback for unanticipated
  // wording (mirrors the OXXO driver).
  if (!validated && !alreadyInvoiced) {
    const verdict = await classifyPortalOutcome({
      pageText: [...seen].join("\n"),
      notes: ALSUPER_OUTCOME_NOTES,
    });
    if (verdict) {
      log.info("Alsuper: AI checkpoint verdict", {
        outcome: verdict.outcome,
        confidence: verdict.confidence,
        reason: verdict.reason,
      });
      if (verdict.outcome === "already_invoiced" && (verdict.confidence ?? 1) >= 0.6) {
        alreadyInvoiced = true;
      }
    }
  }

  if (alreadyInvoiced) {
    log.warn("Alsuper: ticket already invoiced", { folio: data.folio });
    return { validated: false, alreadyInvoiced: true, generated: false, reachedDownload: false };
  }
  if (!validated) {
    log.warn("Alsuper: ticket did not validate", { folio: data.folio });
    return { validated: false, alreadyInvoiced: false, generated: false, reachedDownload: false };
  }

  // --- Step 2: receptor (USO CFDI is the only field; the rest auto-fills from RFC) ---
  await page.waitForTimeout(1500);
  const uso = data.cfdiUsage || "G03";
  // The USO CFDI <select>: prefer one labeled "USO CFDI", else any select carrying
  // the uso code as an option value. Match by code value first, then by option text.
  const usoSelector = await page
    .evaluate((code) => {
      const selects = [...document.querySelectorAll("select")];
      // by an associated <label> mentioning "uso cfdi"
      for (const lab of document.querySelectorAll("label")) {
        if (!/uso\s*cfdi/i.test(lab.textContent || "")) continue;
        const forId = lab.getAttribute("for");
        const el = forId
          ? document.getElementById(forId)
          : lab.querySelector("select");
        if (el && el.tagName === "SELECT" && el.id) return `#${el.id}`;
      }
      // else the select that actually offers this uso code
      const byCode = selects.find((s) =>
        [...s.options].some((o) => o.value === code)
      );
      return byCode && byCode.id ? `#${byCode.id}` : null;
    }, uso)
    .catch(() => null);

  if (usoSelector) {
    await selectOptionInPage(page, usoSelector, (opts) => {
      const byVal = opts.find((o) => o.value === uso);
      if (byVal) return byVal.value;
      const byText = opts.find((o) => o.text.toUpperCase().includes(uso));
      return byText ? byText.value : null;
    });
  } else {
    log.warn("Alsuper: USO CFDI select not found", { uso });
  }

  // Generate (this IS the submit/delivery for Alsuper).
  await page.waitForTimeout(600);
  await clickFirst(page, [
    'button:has-text("Facturar")',
    'input[type=submit][value*="Facturar"]',
    'button[type=submit]',
    'input[type=submit]',
  ]);

  // Wait for the success / download screen. Expose the download controls by following
  // "Ver mis facturas" when it appears, so delivery.js can collect PDF + XML.
  let reachedDownload = false;
  for (let s = 0; s < 14; s++) {
    await page.waitForTimeout(2000);
    const ver = page.locator('a:has-text("Ver mis facturas")').first();
    if (await ver.count().catch(() => 0)) {
      await ver.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    reachedDownload = await page
      .evaluate(() =>
        !![...document.querySelectorAll("button,input[type=submit],a")].find((e) =>
          /descargar (pdf|xml)|guardar|factura generada/i.test(
            e.innerText || e.value || e.getAttribute("aria-label") || e.title || ""
          )
        )
      )
      .catch(() => false);
    if (reachedDownload) break;
  }

  log.info("Alsuper driver finished", { validated, reachedDownload });
  return { validated: true, alreadyInvoiced: false, generated: true, reachedDownload };
}

export default driveAlsuperToDownload;
