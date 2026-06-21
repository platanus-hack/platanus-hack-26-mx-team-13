// Engine — invoice delivery (collect the CFDI files and store them).
//
// After a portal generates the CFDI, the user needs BOTH artifacts: the XML (the
// fiscally-valid invoice) and the PDF (its human representation). On portals that
// deliver by download (OXXO, most retail chains) the files come off a "Descargar
// PDF" / "Descargar XML" screen — we capture their bytes, push them to R2, and
// return a descriptor the run persists on Ticket.invoice.cfdi so the dashboard can
// offer both downloads.
//
// How the capture works (the non-obvious part): these portals render the download
// buttons as PrimeFaces `p:fileDownload` controls — there is NO href and NO
// window.open; clicking does a full <form> POST whose response streams the file
// with a Content-Disposition attachment header. Browserbase can't store it (the
// Stagehand v3 page wrapper exposes neither `newCDPSession` nor a usable
// `page.on('download')`), so we replicate the POST INSIDE the page via
// page.evaluate: serialize every form field (incl. javax.faces.ViewState), add the
// button's clientId param, fetch() it (same-origin → session cookies ride along),
// and read the bytes back as base64. The button ids are auto-generated and shift
// per session, so we locate the buttons by their visible TEXT, never by id.

import { putObjectBuffer } from "@/libs/storage/r2";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:delivery" });

// The visible button labels on the merchant "download your invoice" screen. Matched
// case-insensitively against button/input text — the only stable handle (ids shift).
const PDF_BUTTON_TEXT = "descargar pdf";
const XML_BUTTON_TEXT = "descargar xml";

/**
 * Replicate a PrimeFaces fileDownload form-POST from inside the live page and
 * return the file bytes (base64) + the server's Content-Disposition filename.
 *
 * Runs entirely in the browser context so the request carries the session's
 * cookies and the form's current ViewState. Returns { err } (never throws) when
 * the button isn't on the page, so the caller can treat "no file" uniformly.
 *
 * @param {import("playwright").Page} page - live page on the download screen.
 * @param {string} buttonText - visible button label to match (lowercased contains).
 * @returns {Promise<{b64?:string,len?:number,contentType?:string,filename?:string,err?:string}>}
 */
async function fetchFileViaFormPost(page, buttonText) {
  return page.evaluate(async (label) => {
    const btn = [...document.querySelectorAll("button,input[type=submit]")].find(
      (e) => new RegExp(label, "i").test(e.innerText || e.value || "")
    );
    if (!btn) return { err: "download button not found" };

    const form = btn.closest("form") || document.getElementById("form");
    if (!form) return { err: "no form for download button" };

    // Serialize every successful control, then mark this button as the activated
    // submitter (JSF decodes a UICommand as pressed when its clientId is present).
    const params = new URLSearchParams();
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
      if (el.type === "submit" || el.type === "button") continue;
      params.append(el.name, el.value);
    }
    const btnKey = btn.name || btn.id;
    params.set(btnKey, btn.value || btnKey);

    const res = await fetch(form.action, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
      credentials: "include",
    });
    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return {
      b64: btoa(s),
      len: bytes.length,
      contentType: res.headers.get("content-type") || "",
      filename: parseFilename(res.headers.get("content-disposition") || ""),
    };

    function parseFilename(cd) {
      const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd || "");
      return m ? decodeURIComponent(m[1]) : null;
    }
  }, buttonText);
}

/** True when bytes look like a PDF (`%PDF`). */
function looksLikePdf(buf) {
  return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

/** True when bytes look like XML (`<?xml` or a leading `<`). */
function looksLikeXml(buf) {
  const head = buf.slice(0, 64).toString("utf8").trimStart();
  return head.startsWith("<?xml") || head.startsWith("<");
}

/**
 * Pull the SAT folio fiscal (UUID) out of a CFDI's TimbreFiscalDigital. Returns
 * null when the XML isn't a stamped CFDI (so a non-fatal "delivered without uuid").
 *
 * @param {Buffer} xmlBuffer
 * @returns {string|null}
 */
export function extractCfdiUuid(xmlBuffer) {
  try {
    const xml = xmlBuffer.toString("utf8");
    const m = /UUID="([0-9A-Fa-f-]{36})"/.exec(xml);
    return m ? m[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Capture the CFDI PDF + XML from a live merchant download screen.
 *
 * @param {import("playwright").Page} page - live page sitting on the download screen.
 * @returns {Promise<{ pdf: {buffer:Buffer,filename:string}|null, xml: {buffer:Buffer,filename:string}|null }>}
 */
export async function captureInvoiceFiles(page) {
  if (!page) throw new Error("captureInvoiceFiles: a page is required");

  const out = { pdf: null, xml: null };
  const jobs = [
    ["xml", XML_BUTTON_TEXT, looksLikeXml],
    ["pdf", PDF_BUTTON_TEXT, looksLikePdf],
  ];

  for (const [kind, text, sniff] of jobs) {
    const res = await fetchFileViaFormPost(page, text);
    if (!res || res.err || !res.b64 || !res.len) {
      log.warn("Invoice file capture missed", { kind, reason: res?.err || "empty" });
      continue;
    }
    const buffer = Buffer.from(res.b64, "base64");
    if (!sniff(buffer)) {
      // The POST returned something that isn't the file (an HTML error / redirect).
      log.warn("Captured bytes are not a valid file", {
        kind,
        len: buffer.length,
        head: buffer.slice(0, 24).toString("utf8"),
      });
      continue;
    }
    out[kind] = {
      buffer,
      filename: res.filename || `factura.${kind}`,
    };
    log.info("Invoice file captured", { kind, len: buffer.length, filename: out[kind].filename });
  }

  return out;
}

/**
 * Upload captured CFDI files to R2 and return the descriptor to persist on
 * Ticket.invoice.cfdi. Keys are namespaced per ticket. At least one of pdf/xml
 * must be present, or this throws (an empty delivery is a failure, not a no-op).
 *
 * @param {Object} args
 * @param {string} args.ticketId
 * @param {{ pdf: {buffer:Buffer,filename:string}|null, xml: {buffer:Buffer,filename:string}|null }} args.files
 * @param {number} [args.total] - CFDI total, copied onto the descriptor for the UI.
 * @returns {Promise<{ uuid:string|null, pdfKey:string|null, xmlKey:string|null, pdfName:string|null, xmlName:string|null, total:number|null, deliveredAt:string }>}
 */
export async function deliverInvoiceFiles({ ticketId, files, total = null }) {
  if (!ticketId) throw new Error("deliverInvoiceFiles: ticketId is required");
  const pdf = files?.pdf || null;
  const xml = files?.xml || null;
  if (!pdf && !xml) {
    throw new Error("deliverInvoiceFiles: no CFDI files captured to deliver");
  }

  const base = `invoices/${ticketId}`;
  const descriptor = {
    uuid: xml ? extractCfdiUuid(xml.buffer) : null,
    pdfKey: null,
    xmlKey: null,
    pdfName: pdf?.filename || null,
    xmlName: xml?.filename || null,
    total: total != null ? Number(total) : null,
    deliveredAt: new Date().toISOString(),
  };

  if (xml) {
    descriptor.xmlKey = await putObjectBuffer({
      key: `${base}/cfdi.xml`,
      body: xml.buffer,
      contentType: "application/xml",
    });
  }
  if (pdf) {
    descriptor.pdfKey = await putObjectBuffer({
      key: `${base}/cfdi.pdf`,
      body: pdf.buffer,
      contentType: "application/pdf",
    });
  }

  log.info("CFDI delivered to R2", {
    ticketId,
    uuid: descriptor.uuid,
    hasPdf: Boolean(descriptor.pdfKey),
    hasXml: Boolean(descriptor.xmlKey),
  });

  return descriptor;
}
