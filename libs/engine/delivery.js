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
//
// Not every portal is PrimeFaces. ASP.NET portals (e.g. Alsuper) deliver the same
// files either as a plain `<a href>` download or via an `__doPostBack` button. So
// capture tries, IN ORDER, three same-origin in-page strategies and keeps the first
// whose bytes sniff as a real PDF/XML: (1) the JSF form-POST above, (2) an anchor's
// href, (3) an ASP.NET __doPostBack form-POST. OXXO is unaffected — its JSF POST
// succeeds first, so the fallbacks never run.

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

/**
 * Capture a file delivered as a plain `<a href>` download (ASP.NET portals like
 * Alsuper). Matches the anchor by accessible name (text/aria-label/title) and
 * fetch()es its href same-origin. Returns { err } when no usable anchor exists.
 *
 * @param {import("playwright").Page} page
 * @param {string} buttonText - visible label to match (lowercased contains).
 * @returns {Promise<{b64?:string,len?:number,contentType?:string,filename?:string,err?:string}>}
 */
async function fetchFileViaAnchor(page, buttonText) {
  return page.evaluate(async (label) => {
    const re = new RegExp(label, "i");
    const accName = (e) =>
      e.innerText || e.textContent || e.getAttribute("aria-label") || e.title || "";
    const a = [...document.querySelectorAll("a[href]")].find(
      (e) =>
        re.test(accName(e)) && !/^\s*(#|javascript:)/i.test(e.getAttribute("href") || "")
    );
    if (!a) return { err: "download anchor not found" };

    const res = await fetch(a.href, { credentials: "include" });
    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return {
      b64: btoa(s),
      len: bytes.length,
      contentType: res.headers.get("content-type") || "",
      filename:
        parseFilename(res.headers.get("content-disposition") || "") ||
        a.getAttribute("download") ||
        null,
    };

    function parseFilename(cd) {
      const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd || "");
      return m ? decodeURIComponent(m[1]) : null;
    }
  }, buttonText);
}

/**
 * Capture a file delivered by an ASP.NET WebForms `__doPostBack` button (Alsuper).
 * Serializes the form (incl. __VIEWSTATE / __EVENTVALIDATION), sets __EVENTTARGET /
 * __EVENTARGUMENT from the control's onclick/href (or falls back to the button's own
 * name=value), and POSTs same-origin. Returns { err } when no control matches.
 *
 * @param {import("playwright").Page} page
 * @param {string} buttonText - visible label to match (lowercased contains).
 * @returns {Promise<{b64?:string,len?:number,contentType?:string,filename?:string,err?:string}>}
 */
async function fetchFileViaAspNetPostback(page, buttonText) {
  return page.evaluate(async (label) => {
    const re = new RegExp(label, "i");
    const accName = (e) =>
      e.innerText || e.textContent || e.getAttribute("aria-label") || e.title || e.value || "";
    const el = [
      ...document.querySelectorAll("a,button,input[type=submit],input[type=button]"),
    ].find((e) => re.test(accName(e)));
    if (!el) return { err: "postback control not found" };

    const form = el.closest("form") || document.forms[0];
    if (!form) return { err: "no form for postback control" };

    const params = new URLSearchParams();
    for (const c of form.elements) {
      if (!c.name || c.disabled) continue;
      if ((c.type === "checkbox" || c.type === "radio") && !c.checked) continue;
      if (c.type === "submit" || c.type === "button") continue;
      params.append(c.name, c.value);
    }

    const src = `${el.getAttribute("href") || ""} ${el.getAttribute("onclick") || ""}`;
    const m = /__doPostBack\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/.exec(src);
    if (m) {
      params.set("__EVENTTARGET", m[1]);
      params.set("__EVENTARGUMENT", m[2]);
    } else if (el.name) {
      params.set(el.name, el.value || el.name);
    } else {
      return { err: "no postback target" };
    }

    const res = await fetch(form.action || location.href, {
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
      const mm = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd || "");
      return mm ? decodeURIComponent(mm[1]) : null;
    }
  }, buttonText);
}

/**
 * Capture a file from an embedded viewer or a same-origin link whose URL targets the
 * file type (Alsuper renders the generated CFDI in an <iframe>/<embed> PDF viewer on
 * …/Factura?uuid=…, with no "Descargar" button). Collects candidate URLs from
 * iframe/embed/object src and anchor hrefs matching the requested format, fetches each
 * same-origin, and returns the first non-empty body (the sniff in captureInvoiceFiles
 * rejects wrong types). Returns { err } when nothing matches.
 *
 * @param {import("playwright").Page} page
 * @param {string} buttonText - "descargar pdf" / "descargar xml" — the kind is read from it.
 * @returns {Promise<{b64?:string,len?:number,contentType?:string,filename?:string,err?:string}>}
 */
async function fetchFileViaEmbeddedSrc(page, buttonText) {
  return page.evaluate(async (label) => {
    const wantXml = /xml/i.test(label);
    const fmt = wantXml ? "xml" : "pdf";

    const urls = [];
    const add = (u) => {
      if (!u || /^\s*(#|javascript:|data:|blob:)/i.test(u)) return;
      const lu = u.toLowerCase();
      // Match the format as an extension, path segment, or query hint.
      if (new RegExp(`(\\.|/|=|_|-)${fmt}(\\b|\\?|&|$)`).test(lu) || lu.includes(`format=${fmt}`) || lu.includes(`tipo=${fmt}`)) {
        urls.push(u);
      }
    };
    for (const el of document.querySelectorAll("iframe[src],embed[src],object[data],a[href]")) {
      add(el.getAttribute("src") || el.getAttribute("data") || el.getAttribute("href"));
    }
    if (!urls.length) return { err: "no embedded source" };

    for (const raw of urls) {
      try {
        const abs = new URL(raw, location.href).href;
        const res = await fetch(abs, { credentials: "include" });
        const ab = await res.arrayBuffer();
        const bytes = new Uint8Array(ab);
        if (!bytes.length) continue;
        let s = "";
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return {
          b64: btoa(s),
          len: bytes.length,
          contentType: res.headers.get("content-type") || "",
          filename: parseFilename(res.headers.get("content-disposition") || ""),
        };
      } catch {
        /* try the next candidate */
      }
    }
    return { err: "embedded fetch failed" };

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
  // Tried in order; the first whose bytes sniff as a real file wins. OXXO's JSF
  // POST succeeds first, so the ASP.NET fallbacks (Alsuper) never run for it.
  const STRATEGIES = [
    fetchFileViaFormPost,
    fetchFileViaAnchor,
    fetchFileViaAspNetPostback,
    fetchFileViaEmbeddedSrc,
  ];

  for (const [kind, text, sniff] of jobs) {
    for (const strategy of STRATEGIES) {
      const res = await strategy(page, text);
      if (!res || res.err || !res.b64 || !res.len) continue;
      const buffer = Buffer.from(res.b64, "base64");
      if (!sniff(buffer)) {
        // The response wasn't the file (an HTML error / postback re-render) — let
        // the next strategy try instead of giving up on this file.
        log.warn("Captured bytes are not a valid file", {
          kind,
          strategy: strategy.name,
          len: buffer.length,
          head: buffer.slice(0, 24).toString("utf8"),
        });
        continue;
      }
      out[kind] = { buffer, filename: res.filename || `factura.${kind}` };
      log.info("Invoice file captured", {
        kind,
        strategy: strategy.name,
        len: buffer.length,
        filename: out[kind].filename,
      });
      break;
    }
    if (!out[kind]) log.warn("Invoice file capture missed", { kind });
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
