// SAT catalogs used to normalize data parsed out of a CSF (Constancia de
// Situación Fiscal). Today we only need the tax-regime map; other catalogs
// (CFDI usage, payment methods, etc.) can be added here as scope grows.

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
