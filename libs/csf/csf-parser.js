import PDFParser from "pdf2json";
import { PDFDocument } from "pdf-lib";
import { TAX_REGIMES } from "@/data/sat-catalogs";
import { createLogger } from "@/libs/core/logger";

// Deterministic CSF (Constancia de Situación Fiscal) parser.
//
// The CSF is a structured government PDF that ships with a real text layer, so
// we extract the fiscal profile with pdf2json + regex — NO vision/LLM. Some
// CSFs are exported by third-party tools and have a slightly malformed object
// table that trips pdf2json; for those we re-save the file through pdf-lib
// (which rewrites a clean PDF) and retry once.

const log = createLogger({ component: "csf:parser" });

/**
 * Re-save a (possibly malformed) PDF through pdf-lib to get a clean buffer that
 * pdf2json can read. Used as a fallback when the original parse fails.
 * @param {Buffer} pdfBuffer - The original PDF bytes.
 * @returns {Promise<Buffer>} A re-encoded, clean PDF buffer.
 */
async function cleanCorruptedPDF(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const cleanPdfBytes = await pdfDoc.save();
  log.info(
    `Re-saved PDF via pdf-lib (original ${pdfBuffer.length} bytes → ${cleanPdfBytes.length} bytes)`
  );
  return Buffer.from(cleanPdfBytes);
}

/**
 * Extract the full text layer from a PDF buffer using pdf2json.
 * @param {Buffer} pdfBuffer - The PDF bytes.
 * @returns {Promise<string>} The concatenated, URI-decoded text.
 */
function extractTextFromPDF(pdfBuffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", (errData) => {
      reject(new Error("Failed to parse PDF: " + errData.parserError));
    });

    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      try {
        let fullText = "";

        if (pdfData.Pages && Array.isArray(pdfData.Pages)) {
          pdfData.Pages.forEach((page) => {
            if (page.Texts && Array.isArray(page.Texts)) {
              page.Texts.forEach((text) => {
                // Each text node may contain multiple runs (R); each run's T is
                // URI-encoded.
                if (text.R && Array.isArray(text.R)) {
                  text.R.forEach((run) => {
                    fullText += decodeURIComponent(run.T) + " ";
                  });
                }
              });
              // Separate pages with a newline.
              fullText += "\n";
            }
          });
        }

        resolve(fullText.trim());
      } catch (error) {
        reject(new Error("Failed to process PDF data: " + error.message));
      }
    });

    try {
      pdfParser.parseBuffer(pdfBuffer);
    } catch (error) {
      reject(new Error("Failed to start PDF parsing: " + error.message));
    }
  });
}

/**
 * Extract the RFC (12-13 char alphanumeric tax id).
 * Persona física → 13 chars (4 letters), persona moral → 12 chars (3 letters).
 */
function extractRFC(text) {
  const patterns = [
    /RFC:?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i,
    /R\.F\.C\.?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i,
    /Registro Federal de Contribuyentes:?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i,
    /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].toUpperCase().trim();
  }
  return null;
}

/**
 * Extract the CURP (18 char personal id, present only for personas físicas).
 */
function extractCURP(text) {
  const patterns = [
    /CURP:?\s*([A-Z]{4}\d{6}[HM][A-Z]{5}[0-9A-Z]\d)/i,
    /C\.U\.R\.P\.?\s*([A-Z]{4}\d{6}[HM][A-Z]{5}[0-9A-Z]\d)/i,
    /Clave Única de Registro de Población:?\s*([A-Z]{4}\d{6}[HM][A-Z]{5}[0-9A-Z]\d)/i,
    /\b([A-Z]{4}\d{6}[HM][A-Z]{5}[0-9A-Z]\d)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].toUpperCase().trim();
  }
  return null;
}

/**
 * Extract the business/legal name.
 * Persona física → built from Nombre(s) + Primer/Segundo Apellido.
 * Persona moral → "Denominación o Razón Social".
 */
function extractBusinessName(text) {
  // Persona física: separate name fields. Lookaheads stop the capture at the
  // next labeled field.
  const nombreMatch = text.match(/Nombre\s*\(s\):?\s*([^]+?)(?=\s+Primer Apellido:)/i);
  const primerApellidoMatch = text.match(/Primer Apellido:?\s*([^]+?)(?=\s+Segundo Apellido:)/i);
  const segundoApellidoMatch = text.match(/Segundo Apellido:?\s*([^]+?)(?=\s+Fecha inicio)/i);

  if (nombreMatch && primerApellidoMatch) {
    const nombre = nombreMatch[1].trim();
    const primerApellido = primerApellidoMatch[1].trim();
    const segundoApellido = segundoApellidoMatch ? segundoApellidoMatch[1].trim() : "";
    return `${nombre} ${primerApellido}${segundoApellido ? " " + segundoApellido : ""}`.trim();
  }

  // Persona moral: single legal-name field.
  const patterns = [
    /Nombre[,\s]+Denominación o Razón Social:?\s*([^]+?)(?=\s+idCIF:|\s+RFC:)/i,
    /Razón Social:?\s*([^]+?)(?=\s+RFC:|\s+idCIF:)/i,
    /Denominación:?\s*([^]+?)(?=\s+RFC:|\s+idCIF:)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

/**
 * Extract the trade name (Nombre Comercial). Often blank → returns null.
 */
function extractTradeName(text) {
  const match = text.match(
    /Nombre\s+Comercial:?\s*([^\n]*?)(?=\n\s*(?:Datos\s+del\s+domicilio|Actividades\s+Económicas|Domicilio\s+Fiscal|Régimen|Obligaciones|Tipo\s+de\s+Vialidad|$))/i
  );

  if (!match || !match[1]) return null;

  const value = match[1]
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[:;,\s]+|[:;,\s]+$/g, "");

  // Guard against accidentally capturing text from the next section.
  const looksLikeOtherSection =
    value.includes("Datos del domicilio") ||
    value.includes("Código Postal") ||
    value.includes("Tipo de Vialidad") ||
    value.includes("Actividades Económicas") ||
    value.includes("Domicilio Fiscal") ||
    /^\d{5}$/.test(value.trim());

  if (looksLikeOtherSection) return null;

  if (value && value.length > 0 && value.length < 200 && !/^\d+$/.test(value)) {
    return value;
  }
  return null;
}

/**
 * Extract the list of tax regimes as an array of SAT code strings (e.g.
 * ["601", "612"]), each validated against the SAT catalog. Detects both numeric
 * codes (601, 612, …) and regime names written out in the document. Returning
 * plain code strings keeps the output compatible with Company.taxRegime
 * ([String]); use getTaxRegimeName from the catalog to resolve display names.
 */
function extractTaxRegime(text) {
  const codes = [];

  const addCode = (code) => {
    if (TAX_REGIMES[code] && !codes.includes(code)) codes.push(code);
  };

  // Try to isolate the "Regímenes:" section so we don't pick up stray 3-digit
  // numbers from elsewhere in the document. Fall back to the whole text.
  const sectionPatterns = [
    /Regímenes:\s*([^]*?)(?=\s*Obligaciones:)/i,
    /Regímenes:\s*([^]*?)(?=\s*Datos\s+del\s+domicilio)/i,
    /Regímenes:\s*([^]*?)(?=\s*Actividades\s+Económicas)/i,
    /Regímenes:\s*([^]*?)$/i,
  ];

  let scope = null;
  for (const pattern of sectionPatterns) {
    const match = text.match(pattern);
    if (match) {
      scope = match[1];
      break;
    }
  }

  const haystack = scope || text;

  // Match regimes by name (PDFs that omit the numeric code).
  for (const [code, fullName] of Object.entries(TAX_REGIMES)) {
    const namePattern = fullName
      .replace(/[()]/g, "")
      .split(" ")
      .filter((word) => word.length > 3)
      .join(".*");
    if (new RegExp(namePattern, "i").test(haystack)) addCode(code);
  }

  // "Régimen Simplificado de Confianza" → 626 (explicit safety net).
  if (/Régimen\s+Simplificado\s+de\s+Confianza/i.test(haystack)) addCode("626");

  // Match regimes by numeric code, validated against the catalog.
  const numericCodes = haystack.match(/\b\d{3}\b/g) || [];
  numericCodes.forEach(addCode);

  if (codes.length === 0) {
    log.warn("No tax regimes detected in the document");
  }

  return codes;
}

/**
 * Extract the registry status (Estatus en el padrón). Defaults to "ACTIVO".
 */
function extractRegistryStatus(text) {
  const patterns = [
    /Estatus[^\n]*:?\s*(ACTIVO|INACTIVO|SUSPENDIDO)/i,
    /Status[^\n]*:?\s*(ACTIVO|INACTIVO|SUSPENDIDO)/i,
    /Situación[^\n]*:?\s*(ACTIVO|INACTIVO|SUSPENDIDO)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].toUpperCase().trim();
  }
  return "ACTIVO";
}

const SPANISH_MONTHS = {
  ENERO: "01",
  FEBRERO: "02",
  MARZO: "03",
  ABRIL: "04",
  MAYO: "05",
  JUNIO: "06",
  JULIO: "07",
  AGOSTO: "08",
  SEPTIEMBRE: "09",
  OCTUBRE: "10",
  NOVIEMBRE: "11",
  DICIEMBRE: "12",
};

/**
 * Extract "Fecha inicio de operaciones" and normalize to YYYY-MM-DD.
 * Handles both "01 DE ENERO DE 2012" and "01/01/2012" formats.
 */
function extractOperationsStartDate(text) {
  const textMatch = text.match(
    /Fecha\s+inicio\s+de\s+operaciones:?\s*(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚÑ]+)\s+DE\s+(\d{4})/i
  );
  if (textMatch) {
    const day = textMatch[1].padStart(2, "0");
    const month = SPANISH_MONTHS[textMatch[2].toUpperCase()];
    const year = textMatch[3];
    if (month) return `${year}-${month}-${day}`;
  }

  const patterns = [
    /Fecha de inicio de operaciones:?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Inicio de operaciones:?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Fecha de alta:?\s*(\d{2}\/\d{2}\/\d{4})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const [day, month, year] = match[1].split("/");
      return `${year}-${month}-${day}`;
    }
  }
  return null;
}

/**
 * Extract the full fiscal address using the exact SAT field labels.
 */
function extractFiscalAddress(text) {
  const address = {
    streetType: null,
    streetName: null,
    exteriorNumber: null,
    interiorNumber: null,
    neighborhood: null,
    postalCode: null,
    locality: null,
    municipality: null,
    state: null,
    country: "México",
    betweenStreets: null,
  };

  const postalCodeMatch = text.match(/Código Postal:?\s*(\d{5})/i);
  if (postalCodeMatch) address.postalCode = postalCodeMatch[1].trim();

  // Street type may carry abbreviations in parentheses, e.g.
  // "CERRADA (CDA) O PRIVADA (PRIV)" — keep the last keyword. Bound the capture
  // at the next label so we don't swallow "Nombre de Vialidad: ..." after it.
  const streetTypeMatch = text.match(/Tipo de Vialidad:?\s*([^]+?)(?=\s+Nombre de Vialidad:)/i);
  if (streetTypeMatch) {
    const raw = streetTypeMatch[1].trim();
    const mainType = raw.match(/([A-ZÁÉÍÓÚÑ]+)(?:\s*\([^)]+\))?$/i);
    address.streetType = mainType ? mainType[1].trim() : raw;
  }

  const streetNameMatch = text.match(/Nombre de Vialidad:?\s*([^]+?)(?=\s+Número Exterior:)/i);
  if (streetNameMatch) address.streetName = streetNameMatch[1].trim();

  const exteriorMatch = text.match(/Número Exterior:?\s*([^]+?)(?=\s+Número Interior:)/i);
  if (exteriorMatch) {
    const value = exteriorMatch[1].trim();
    if (value && value.length > 0 && !value.includes("Número Interior")) {
      address.exteriorNumber = value;
    }
  }

  const interiorMatch = text.match(/Número Interior:?\s*([^]+?)(?=\s+Nombre de la Colonia:)/i);
  if (interiorMatch) {
    const value = interiorMatch[1].trim();
    if (value && value.length > 1 && !value.includes("Nombre de la Colonia") && value !== ":") {
      address.interiorNumber = value;
    }
  }

  const neighborhoodMatch = text.match(/Nombre de la Colonia:?\s*([^]+?)(?=\s+Nombre de la Localidad:)/i);
  if (neighborhoodMatch) address.neighborhood = neighborhoodMatch[1].trim();

  const localityMatch = text.match(/Nombre de la Localidad:?\s*([^]+?)(?=\s+Nombre del Municipio)/i);
  if (localityMatch) address.locality = localityMatch[1].trim();

  const municipalityMatch = text.match(
    /Nombre del Municipio o Demarcación Territorial:?\s*([^]+?)(?=\s+Nombre de la Entidad Federativa:)/i
  );
  if (municipalityMatch) address.municipality = municipalityMatch[1].trim();

  const stateMatch = text.match(/Nombre de la Entidad Federativa:?\s*([^]+?)(?=\s+Entre Calle:)/i);
  if (stateMatch) address.state = stateMatch[1].trim();

  // pdf2json only inserts newlines between pages, so the whole address block is
  // usually one line. Bound the capture at the next SAT label/section header (or
  // end of text) instead of taking the rest of the page.
  const betweenStreetsMatch = text.match(
    /Entre Calle:?\s*([^]+?)(?=\s+(?:Y Calle:|Datos\s+de\s+actividades|Actividades\s+Económicas|Regímenes:|Obligaciones:|Características\s+fiscales)|\s*$)/i
  );
  if (betweenStreetsMatch) {
    const value = betweenStreetsMatch[1].trim();
    if (value && value !== ":") address.betweenStreets = value;
  }

  return address;
}

/**
 * Parse already-extracted CSF text into a structured fiscal profile.
 * Throws if the document does not look like a valid CSF (no RFC / no name).
 * @param {string} text - Text extracted from a CSF PDF.
 * @returns {Object} The structured fiscal profile.
 */
export function parseCSFData(text) {
  if (!text || text.trim().length === 0) {
    throw new Error("The PDF text layer is empty — not a valid CSF");
  }

  const rfc = extractRFC(text);
  const businessName = extractBusinessName(text);

  // Critical validations: a CSF must always carry an RFC and a name.
  if (!rfc) {
    throw new Error("No RFC found — not a valid CSF");
  }
  if (!businessName) {
    throw new Error("No business name found — not a valid CSF");
  }

  return {
    rfc,
    curp: extractCURP(text) || null,
    businessName,
    tradeName: extractTradeName(text),
    taxRegime: extractTaxRegime(text),
    registryStatus: extractRegistryStatus(text),
    operationsStartDate: extractOperationsStartDate(text),
    fiscalAddress: extractFiscalAddress(text),
  };
}

/**
 * Process a CSF PDF buffer end-to-end: extract its text layer (re-saving a
 * corrupted PDF through pdf-lib and retrying once if needed), then parse the
 * fiscal profile out of it.
 * @param {Buffer} pdfBuffer - The CSF PDF bytes.
 * @returns {Promise<Object>} The structured fiscal profile.
 */
export async function processCSFPDF(pdfBuffer) {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error("Empty PDF buffer");
  }

  let text;
  try {
    text = await extractTextFromPDF(pdfBuffer);
  } catch (originalError) {
    log.warn("Initial PDF text extraction failed, retrying with a clean re-save:", originalError.message);
    try {
      const cleanBuffer = await cleanCorruptedPDF(pdfBuffer);
      text = await extractTextFromPDF(cleanBuffer);
    } catch (cleanError) {
      throw new Error(
        `Could not read the PDF. Original error: ${originalError.message}. Cleanup error: ${cleanError.message}`
      );
    }
  }

  return parseCSFData(text);
}
