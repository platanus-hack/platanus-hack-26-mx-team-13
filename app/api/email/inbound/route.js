import { NextResponse } from "next/server";
import { Webhook } from "svix";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import User from "@/models/User";
import { putObjectBuffer } from "@/libs/storage/r2";
import {
  listReceivedAttachments,
  downloadAttachment,
  sendInvoiceDelivered,
} from "@/libs/core/email";
import { ticketIdFromRecipients } from "@/libs/engine/invoiceMailbox";
import { INVOICE_STATUS } from "@/libs/engine/state";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "api:email-inbound" });

// Resend posts inbound mail here (signed via Svix). Never prerender — it reads
// the raw request body to verify the signature and writes to the DB on each call.
export const dynamic = "force-dynamic";

// Resend's inbound webhook for a received email.
const RECEIVED_EVENT = "email.received";

// Decide where an attachment belongs by filename/content type. XML is the CFDI
// of record; PDF is the human-readable copy. Anything else is ignored.
function classifyAttachment(att) {
  const name = (att.filename || "").toLowerCase();
  const type = (att.content_type || "").toLowerCase();
  if (name.endsWith(".xml") || type.includes("xml")) return "xml";
  if (name.endsWith(".pdf") || type.includes("pdf")) return "pdf";
  return null;
}

// POST /api/email/inbound
// Resend `email.received` webhook. Verifies the Svix signature, recovers the
// ticket from the catch-all recipient (`<ticketId>@facturas.facturin.mx`), pulls
// the CFDI attachments via the Resend API, stores them in R2, marks the ticket
// DELIVERED, and emails the client a copy.
export async function POST(request) {
  // Raw body is required for signature verification — read it once, parse later.
  const payload = await request.text();

  // Verify the webhook came from Resend. Skipped only when no secret is set
  // (local dev); in any deployed env RESEND_WEBHOOK_SECRET must be present.
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    try {
      new Webhook(secret).verify(payload, {
        "svix-id": request.headers.get("svix-id"),
        "svix-timestamp": request.headers.get("svix-timestamp"),
        "svix-signature": request.headers.get("svix-signature"),
      });
    } catch (err) {
      log.warn("rejected: bad signature", { message: err.message });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else {
    log.warn("RESEND_WEBHOOK_SECRET not set — skipping signature verification");
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Ack non-received events (deliveries, bounces, etc.) so Resend stops retrying.
  if (event?.type !== RECEIVED_EVENT) {
    return NextResponse.json({ ignored: event?.type ?? "unknown" });
  }

  const data = event.data || {};
  const ticketId = ticketIdFromRecipients(data.to);
  if (!ticketId) {
    // Not one of our per-ticket addresses — ack so it isn't retried forever.
    log.warn("no ticket address in recipients", { to: data.to });
    return NextResponse.json({ ignored: "no-ticket-address" });
  }

  try {
    await connectMongoose();
    const ticket = await Ticket.findById(ticketId).lean();
    if (!ticket) {
      log.warn("ticket not found", { ticketId });
      return NextResponse.json({ ignored: "ticket-not-found" });
    }

    // Pull attachment metadata (the webhook payload carries none), then download
    // the CFDI files and store them in R2 under the ticket owner.
    const attachments = await listReceivedAttachments(data.email_id);
    const stored = {};
    const emailCopies = [];

    for (const att of attachments) {
      const kind = classifyAttachment(att);
      if (!kind || stored[kind]) continue; // keep the first XML and first PDF

      const bytes = await downloadAttachment(att.download_url);
      const key = `invoices/${ticket.userId}/${ticketId}.${kind}`;
      await putObjectBuffer({
        key,
        body: bytes,
        contentType: kind === "xml" ? "application/xml" : "application/pdf",
      });
      stored[kind] = key;
      emailCopies.push({ filename: att.filename || `factura.${kind}`, content: bytes });
    }

    if (!stored.xml && !stored.pdf) {
      log.warn("received email with no CFDI attachments", { ticketId });
      return NextResponse.json({ ignored: "no-cfdi-attachments" });
    }

    // Mark the invoice subdoc as delivered. Dot-paths update in place without
    // disturbing the rest of the engine state.
    await Ticket.updateOne(
      { _id: ticketId },
      {
        $set: {
          "invoice.status": INVOICE_STATUS.DELIVERED,
          "invoice.deliveryMode": "email",
          "invoice.deliveredAt": new Date(),
          ...(stored.xml ? { "invoice.xmlKey": stored.xml } : {}),
          ...(stored.pdf ? { "invoice.pdfKey": stored.pdf } : {}),
        },
      }
    );

    // Forward a copy to the client (best-effort; never fails the webhook).
    const user = await User.findById(ticket.userId).lean();
    if (user?.email) {
      await sendInvoiceDelivered({
        to: user.email,
        merchantName: ticket.invoice?.merchantName,
        attachments: emailCopies,
      });
    }

    log.info("CFDI delivered", {
      ticketId,
      xml: !!stored.xml,
      pdf: !!stored.pdf,
    });
    return NextResponse.json({ ok: true, ticketId, stored: Object.keys(stored) });
  } catch (err) {
    // Return 500 so Resend retries — a transient R2/DB/API hiccup shouldn't drop
    // the only copy of a CFDI we'll ever receive.
    log.error("inbound processing failed", { ticketId, message: err.message });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
