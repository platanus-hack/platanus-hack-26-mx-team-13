// Email layer — Resend for both outbound (notify the client) and inbound
// retrieval (pull the CFDI attachments a merchant portal mailed us).
//
// Inbound design (see libs/engine/invoiceMailbox.js): Resend's `email.received`
// webhook carries only METADATA — the attachment bytes are NOT in the payload.
// We fetch them on demand via the Received Email Attachments API, which returns
// a short-lived `download_url` per attachment.
//
// Env:
//   RESEND_API_KEY        — required to send and to read received emails.
//   RESEND_WEBHOOK_SECRET — Svix signing secret for the inbound webhook (verified in the route).

import { Resend } from "resend";
import config from "@/config";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "core:email" });

// Cache the client on globalThis so dev hot-reload reuses one instance.
let client = globalThis._resendClient;

function getClient() {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Resend is not configured — set RESEND_API_KEY in .env.local"
    );
  }
  client = globalThis._resendClient = new Resend(apiKey);
  return client;
}

/**
 * List the attachments of a received (inbound) email by its Resend email id.
 * Each item carries metadata plus a short-lived `download_url`.
 *
 * The Resend Node SDK does not (yet) wrap the received-attachments endpoint, so
 * we call the REST API directly with the same API key.
 *
 * @param {string} emailId - `data.email_id` from the `email.received` webhook.
 * @returns {Promise<Array<{id:string,filename:string,content_type:string,download_url:string}>>}
 */
export async function listReceivedAttachments(emailId) {
  if (!emailId) throw new Error("listReceivedAttachments: emailId is required");
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Resend is not configured — set RESEND_API_KEY");
  }

  const res = await fetch(
    `https://api.resend.com/emails/received/${emailId}/attachments`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Resend attachments API ${res.status}: ${body.slice(0, 300)}`
    );
  }
  const json = await res.json();
  // The API returns { data: [...] }; tolerate a bare array too.
  return Array.isArray(json) ? json : json.data || [];
}

/**
 * Download one attachment's bytes from its short-lived `download_url`.
 *
 * @param {string} downloadUrl - The `download_url` from listReceivedAttachments.
 * @returns {Promise<Buffer>} The attachment bytes.
 */
export async function downloadAttachment(downloadUrl) {
  if (!downloadUrl) throw new Error("downloadAttachment: downloadUrl is required");
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`downloadAttachment: ${res.status} fetching attachment`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Notify the client that their CFDI has arrived and is available in Facturín.
 * Best-effort: logs and resolves false on failure instead of throwing, so a
 * delivery email never breaks the inbound pipeline that already stored the XML.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient (the user's account email).
 * @param {string} params.merchantName - Merchant the invoice is from (display).
 * @param {Array<{filename:string,content:Buffer}>} [params.attachments] - CFDI files to attach.
 * @returns {Promise<boolean>} true when Resend accepted the message.
 */
export async function sendInvoiceDelivered({ to, merchantName, attachments = [] }) {
  if (!to) {
    log.warn("sendInvoiceDelivered: no recipient, skipping");
    return false;
  }

  const merchant = merchantName || "tu compra";
  try {
    const { error } = await getClient().emails.send({
      from: config.resend.fromNoReply,
      to,
      subject: `Tu factura de ${merchant} ya está lista`,
      text: `Recibimos tu factura (CFDI) de ${merchant}. La adjuntamos a este correo y también puedes consultarla en Facturín.`,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    });
    if (error) {
      log.error("sendInvoiceDelivered: Resend returned an error", { error });
      return false;
    }
    return true;
  } catch (err) {
    log.error("sendInvoiceDelivered: failed to send", { message: err.message });
    return false;
  }
}
