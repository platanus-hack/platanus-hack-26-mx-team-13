// SAT catalogs used to normalize fiscal data: tax regimes (parsed from the CSF)
// and uso de CFDI (the "tipo de gasto" the receptor picks per ticket at invoice
// time). Other catalogs (payment methods, etc.) can be added here as scope grows.

// Tax regimes (Régimen Fiscal) — official SAT codes mapped to their names.
// Source: SAT "c_RegimenFiscal" catalog.
export const TAX_REGIMES = {
  "601": "General de Ley Personas Morales",
  "603": "Personas Morales con Fines no Lucrativos",
  "605": "Sueldos y Salarios e Ingresos Asimilados a Salarios",
  "606": "Arrendamiento",
  "607": "Régimen de Enajenación o Adquisición de Bienes",
  "608": "Demás ingresos",
  "610": "Residentes en el Extranjero sin Establecimiento Permanente en México",
  "611": "Ingresos por Dividendos (socios y accionistas)",
  "612": "Personas Físicas con Actividades Empresariales y Profesionales",
  "614": "Ingresos por intereses",
  "615": "Régimen de los ingresos por obtención de premios",
  "616": "Sin obligaciones fiscales",
  "620": "Sociedades Cooperativas de Producción que optan por diferir sus ingresos",
  "621": "Incorporación Fiscal",
  "622": "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras",
  "623": "Opcional para Grupos de Sociedades",
  "624": "Coordinados",
  "625": "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas",
  "626": "Régimen Simplificado de Confianza",
};

/**
 * Resolve a SAT tax-regime code to its human-readable name.
 * @param {string} code - SAT regime code, e.g. "612".
 * @returns {string|null} The regime name, or null if the code is unknown.
 */
export function getTaxRegimeName(code) {
  if (!code) return null;
  return TAX_REGIMES[String(code).trim()] || null;
}

// Uso de CFDI (Régimen → "c_UsoCFDI") — official SAT codes mapped to their names.
// The receptor picks one per invoice ("tipo de gasto"). Codes D01–D10 are personal
// deductions valid only for personas físicas; we expose the full catalog and let the
// portal / SAT enforce régimen validity (no client-side filtering yet — v2).
// Source: SAT "c_UsoCFDI" catalog.
export const CFDI_USAGES = {
  G01: "Adquisición de mercancías",
  G02: "Devoluciones, descuentos o bonificaciones",
  G03: "Gastos en general",
  I01: "Construcciones",
  I02: "Mobiliario y equipo de oficina por inversiones",
  I03: "Equipo de transporte",
  I04: "Equipo de cómputo y accesorios",
  I05: "Dados, troqueles, moldes, matrices y herramental",
  I06: "Comunicaciones telefónicas",
  I07: "Comunicaciones satelitales",
  I08: "Otra maquinaria y equipo",
  D01: "Honorarios médicos, dentales y gastos hospitalarios",
  D02: "Gastos médicos por incapacidad o discapacidad",
  D03: "Gastos funerales",
  D04: "Donativos",
  D05: "Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)",
  D06: "Aportaciones voluntarias al SAR",
  D07: "Primas por seguros de gastos médicos",
  D08: "Gastos de transportación escolar obligatoria",
  D09: "Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones",
  D10: "Pagos por servicios educativos (colegiaturas)",
  S01: "Sin efectos fiscales",
  CP01: "Pagos",
  CN01: "Nómina",
  P01: "Por definir",
};

/** Default uso de CFDI when none is chosen — the most common for expense receipts. */
export const DEFAULT_CFDI_USAGE = "G03";

/**
 * Resolve a SAT uso-de-CFDI code to its human-readable name.
 * @param {string} code - Uso CFDI code, e.g. "G03".
 * @returns {string|null} The usage name, or null if the code is unknown.
 */
export function getCfdiUsageName(code) {
  if (!code) return null;
  return CFDI_USAGES[String(code).trim().toUpperCase()] || null;
}

// Ordered, curated list for the upload UI's "tipo de gasto" picker: G03 (the
// default) first, then the rest of gastos/inversiones (G*/I*), then personal
// deductions (D*), then the special codes. Full catalog so the user can pick
// funerales, colegiaturas, etc.; régimen-based filtering is deferred (v2).
const CFDI_USAGE_ORDER = [
  "G03", "G01", "G02",
  "I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08",
  "D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10",
  "S01", "CP01", "CN01", "P01",
];

export const CFDI_USAGE_OPTIONS = CFDI_USAGE_ORDER.map((code) => ({
  code,
  name: CFDI_USAGES[code],
}));
