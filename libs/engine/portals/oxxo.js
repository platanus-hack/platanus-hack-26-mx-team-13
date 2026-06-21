// Deterministic portal driver — OXXO (Cadena Comercial OXXO).
//
// The generic recipe replay (libs/engine/nodes/replayRecipe.js) handles simple
// "fill these inputs" portals. OXXO's facturación portal is a heavy PrimeFaces SPA
// with three quirks a flat selector list can't express, so it gets a hand-authored
// driver (the project's "deterministic path for top merchants" strategy):
//
//   1. A readonly jQuery-UI datepicker — the sale date can't be typed, you open the
//      calendar and click the day (navigating months when the ticket isn't current).
//   2. A two-stage gate — you enter date+folio+ID-de-venta+total and click
//      "Validar Ticket"; the fiscal section stays LOCKED until OXXO confirms with a
//      "El ticket ingresado es válido" toast. We WAIT for that toast (the validation
//      gate) before continuing — typing into a not-yet-validated form silently fails.
//   3. PrimeFaces selectOneMenu overlays — País/Estado/Régimen/Uso CFDI are not
//      <select>s; you click the _label to open the panel and click the option by its
//      VISIBLE TEXT (the recorded li:nth-of-type positions are specific to whoever
//      recorded them — régimen 612 vs RESICO — so we resolve by text, never position).
//
// The driver leaves the page sitting on the "Descargar PDF / Descargar XML" screen;
// libs/engine/delivery.js then collects the files. It never logs in (CAPTCHA-free
// public flow) and never clicks a destructive control beyond "Generar Factura",
// which IS the submit for this portal (delivery, not a draft).

import { getTaxRegimeName } from "@/data/sat-catalogs";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:portal:oxxo" });

// The merchant key (issuing RFC) this driver handles. resolve_portal canonicalizes
// the OXXO KnownMerchant to this RFC, so the engine selects the driver by it.
export const OXXO_RFC = "CCO8605231N4";
export const OXXO_PORTAL_URL =
  "https://www4.oxxo.com:9443/facturacionElectronica-web/views/layout/inicio.do";

// Spanish month names as the datepicker renders them in its title bar.
const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Distinctive substring per SAT tax-regime code — OXXO lists régimen options by
// NAME only (no code), so we match the option text on this keyword. Falls back to
// the full catalog name when a code isn't mapped here.
const REGIMEN_MATCH = {
  "601": "General de Ley Personas Morales",
  "603": "Fines no Lucrativos",
  "605": "Sueldos y Salarios",
  "606": "Arrendamiento",
  "607": "Demás ingresos",
  "608": "Demás ingresos",
  "610": "Residentes en el Extranjero",
  "611": "Dividendos",
  "612": "Actividades Empresariales y Profesionales",
  "614": "Intereses",
  "616": "Sin obligaciones fiscales",
  "620": "Sociedades Cooperativas",
  "621": "Incorporación Fiscal",
  "622": "Actividades Agrícolas",
  "623": "Grupos de Sociedades",
  "624": "Coordinados",
  "625": "plataformas tecnológicas",
  "626": "Simplificado de Confianza",
};

// Uso de CFDI code → option text keyword (OXXO lists by name).
const USO_MATCH = {
  G01: "Adquisición de mercancías",
  G02: "Devoluciones",
  G03: "Gastos en general",
  I01: "Construcciones",
  P01: "Por definir",
  S01: "Sin efectos fiscales",
  CP01: "Pagos",
};

const VALID_TOAST = "ticket ingresado es válido";

// OXXO's "this receipt was already invoiced" responses — no valid toast ever
// appears for these, so detect them explicitly instead of spinning out the
// validation budget and reporting a generic non-validation. Covers "ya fue
// facturado", "ya está facturado", "ya se encuentra facturado/a", etc.
const ALREADY_INVOICED_RE = /ya\s.{0,30}facturad[oa]|previamente\sfacturad[oa]|ticket\sya\sfacturad/i;

/** CSS id selector for a PrimeFaces `form:<id>` element (escapes the colon). */
const E = (id) => "#form\\:" + String(id).replace(/:/g, "\\:");

/** Whole-page innerText, whitespace-collapsed — for toast/state detection. */
async function bodyText(page) {
  const t = await page.locator("body").first().innerText().catch(() => "");
  return t.replace(/\s+/g, " ");
}

/** Click + fill an input by its `form:<id>`, best-effort. */
async function setField(page, id, value) {
  const loc = page.locator(E(id)).first();
  await loc.click({ timeout: 4000 }).catch(() => {});
  await loc.fill(String(value), { timeout: 5000 }).catch(() => {});
  return loc.inputValue().catch(() => "");
}

/**
 * Select an option in a PrimeFaces selectOneMenu by visible text: click the
 * `<base>_label` to open the overlay, then click the `<base>_panel li` whose text
 * contains `match`. Returns the chosen option text, or null if nothing matched.
 */
async function selectByText(page, base, match) {
  await page.locator(E(base + "_label")).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(900);
  const lis = page.locator(E(base + "_panel") + " li");
  const n = await lis.count();
  const want = String(match).toLowerCase();
  for (let i = 0; i < n; i++) {
    const text = (await lis.nth(i).innerText().catch(() => "")).trim();
    if (text && text.toLowerCase().includes(want)) {
      await lis.nth(i).click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(400);
      return text;
    }
  }
  return null;
}

/** Break a Date|ISO-string into {day, month0, year} without TZ drift. */
function dateParts(value) {
  if (typeof value === "string") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (iso) return { day: +iso[3], month0: +iso[2] - 1, year: +iso[1] };
    const dmy = /(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
    if (dmy) return { day: +dmy[1], month0: +dmy[2] - 1, year: +dmy[3] };
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  return { day: d.getUTCDate(), month0: d.getUTCMonth(), year: d.getUTCFullYear() };
}

/**
 * Open the datepicker and select the ticket's sale date, navigating months when
 * the ticket isn't in the month the calendar opens on. Returns true when the input
 * ended up holding a date.
 */
async function pickSaleDate(page, dateValue) {
  const parts = dateParts(dateValue);
  if (!parts) {
    log.warn("OXXO: unparseable sale date, skipping datepicker", { dateValue });
    return false;
  }
  await page.locator(E("fecha_input")).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(900);

  // Navigate to the target month/year (bounded so a parse miss can't loop forever).
  const targetTitle = `${MONTHS_ES[parts.month0]} ${parts.year}`;
  for (let hop = 0; hop < 24; hop++) {
    const title = (
      await page.locator(".ui-datepicker-title").first().innerText().catch(() => "")
    ).trim().toLowerCase();
    if (!title || title === targetTitle) break;
    // Decide direction by comparing (year, month) ordinals.
    const m = /([a-záéíóú]+)\s+(\d{4})/i.exec(title);
    const curMonth = m ? MONTHS_ES.indexOf(m[1].toLowerCase()) : parts.month0;
    const curYear = m ? +m[2] : parts.year;
    const cur = curYear * 12 + curMonth;
    const tgt = parts.year * 12 + parts.month0;
    const btn = cur > tgt ? ".ui-datepicker-prev" : ".ui-datepicker-next";
    await page.locator(btn).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  // Click the day cell whose link text is exactly the day-of-month.
  const days = page.locator(
    "#ui-datepicker-div a, .ui-datepicker-calendar a, " + E("fecha_panel") + " a"
  );
  const n = await days.count();
  for (let i = 0; i < n; i++) {
    if (((await days.nth(i).innerText().catch(() => "")).trim()) === String(parts.day)) {
      await days.nth(i).click({ timeout: 4000 }).catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(400);
  const val = await page.locator(E("fecha_input")).first().inputValue().catch(() => "");
  return Boolean(val);
}

/**
 * Drive the OXXO portal end-to-end with a ticket's data and leave the page on the
 * "Descargar PDF / XML" screen.
 *
 * @param {import("playwright").Page} page - live page (navigated to the portal or blank).
 * @param {import("@/libs/engine/billingData").BillingData & {venta?:string|null}} data
 * @returns {Promise<{ validated: boolean, alreadyInvoiced: boolean, generated: boolean, reachedDownload: boolean }>}
 */
export async function driveOxxoToDownload(page, data) {
  // Land on the portal (idempotent — init_navigate may already be here).
  if (!String(page.url() || "").includes("oxxo.com")) {
    await page.goto(OXXO_PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await page.waitForTimeout(3500);

  // Dismiss the "info ticket" dialog if it auto-opened.
  try {
    const x = page.locator("#form\\:dlgInfoTicket > div:nth-of-type(1) > a").first();
    if (await x.count()) await x.click({ timeout: 4000 });
  } catch {
    /* no dialog — fine */
  }
  await page.waitForTimeout(700);

  // --- Gate: sale data ---
  await pickSaleDate(page, data.date);
  await setField(page, "folio", data.folio ?? "");
  // OXXO's "ID de venta" — sourced from the ticket (extracted.venta).
  if (data.venta) await setField(page, "venta", data.venta);
  if (data.total != null) await setField(page, "total", Number(data.total).toFixed(2));

  await page.locator(E("validarTicket")).first().click({ timeout: 6000 }).catch(() => {});

  // Validation gate — wait for the explicit "es válido" toast (the observe the
  // form actually needs), while watching for the "already invoiced" message: an
  // already-facturado receipt never produces the valid toast, so detect it here so
  // the run ends with a clear terminal reason instead of a generic non-validation.
  let validated = false;
  let alreadyInvoiced = false;
  for (let s = 0; s < 7; s++) {
    await page.waitForTimeout(1800);
    const body = await bodyText(page);
    if (body.includes(VALID_TOAST)) {
      validated = true;
      break;
    }
    if (ALREADY_INVOICED_RE.test(body)) {
      alreadyInvoiced = true;
      break;
    }
  }
  if (alreadyInvoiced) {
    log.warn("OXXO: ticket already invoiced", { folio: data.folio });
    return { validated: false, alreadyInvoiced: true, generated: false, reachedDownload: false };
  }
  if (!validated) {
    log.warn("OXXO: ticket did not validate", { folio: data.folio });
    return { validated: false, alreadyInvoiced: false, generated: false, reachedDownload: false };
  }

  // --- Advance to the fiscal section ---
  await page.locator(E("continuar")).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(3500);

  // --- Fiscal data (receptor) ---
  await selectByText(page, "selectOneMenuPais", "xico"); // México (fixed)
  if (data.rfc) await setField(page, "rfc", data.rfc);
  if (data.businessName) await setField(page, "razon", data.businessName);
  if (data.street) await setField(page, "calle", data.street);
  if (data.exteriorNumber) await setField(page, "ext", data.exteriorNumber);
  if (data.colonia) await setField(page, "colonia", data.colonia);
  if (data.municipality) await setField(page, "dele", data.municipality);
  if (data.postalCode) await setField(page, "codigo", data.postalCode);
  if (data.state) await selectByText(page, "estado", data.state);

  const regimeKeyword =
    REGIMEN_MATCH[data.taxRegime] || getTaxRegimeName(data.taxRegime) || "";
  if (regimeKeyword) await selectByText(page, "selectOneMenuRegFis", regimeKeyword);

  const usoKeyword = USO_MATCH[data.cfdiUsage] || "Gastos en general";
  await selectByText(page, "selectOneMenuCFDI", usoKeyword);

  // --- Generate (this IS the submit/delivery for OXXO) ---
  await page.locator(E("generarFactura")).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3000);
  // Confirm dialog, if any.
  for (const t of ["Aceptar", "Sí", "Si", "Confirmar"]) {
    const b = page.locator(`.ui-dialog button:has-text("${t}"), .ui-confirmdialog button:has-text("${t}")`).first();
    try {
      if (await b.count()) {
        await b.click({ timeout: 3000 });
        break;
      }
    } catch {
      /* keep trying the next label */
    }
  }

  // Wait for the download screen ("Descargar PDF" present).
  let reachedDownload = false;
  for (let s = 0; s < 14; s++) {
    await page.waitForTimeout(2500);
    reachedDownload = await page.evaluate(
      () => !![...document.querySelectorAll("button,input[type=submit],a")].find((e) =>
        /descargar pdf/i.test(e.innerText || e.value || "")
      )
    ).catch(() => false);
    if (reachedDownload) break;
  }

  log.info("OXXO driver finished", { validated, reachedDownload });
  return { validated: true, alreadyInvoiced: false, generated: true, reachedDownload };
}

export default driveOxxoToDownload;
