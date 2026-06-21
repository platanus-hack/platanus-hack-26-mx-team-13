// Per-ticket inbound mailbox — single source of truth for the catch-all address.
//
// Some merchant portals deliver the CFDI by EMAIL instead of a direct download.
// For those, the fill step writes one of OUR addresses into the portal's email
// field instead of the user's, so Facturín receives the XML/PDF and can store it
// and surface it to the client. We use a catch-all subdomain (one MX record) so
// every ticket gets a unique address WITHOUT provisioning per-ticket inboxes:
//
//     <ticketId>@<RESEND_RECEIVING_DOMAIN>
//
// Resend forwards anything sent to that domain to our inbound webhook; we route
// by parsing the ticketId back out of the recipient (`to`) here.

import config from "@/config";

// 24-hex Mongo ObjectId. The local-part IS the ticket _id, nothing else, so the
// match must be exact to avoid pairing a stray address with the wrong ticket.
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

/**
 * The receiving domain catch-all addresses live under (e.g. "facturas.facturin.mx").
 * Overridable via RESEND_RECEIVING_DOMAIN for staging/preview domains.
 * @returns {string}
 */
export function getReceivingDomain() {
  return process.env.RESEND_RECEIVING_DOMAIN || config.resend.receivingDomain;
}

/**
 * Build the inbound address for a ticket: `<ticketId>@<receivingDomain>`.
 *
 * @param {string} ticketId - The Ticket _id (24-hex string).
 * @returns {string} The catch-all address the portal should send the CFDI to.
 */
export function inboxAddressForTicket(ticketId) {
  const id = String(ticketId || "").trim();
  if (!OBJECT_ID_RE.test(id)) {
    throw new Error(`inboxAddressForTicket: invalid ticketId "${ticketId}"`);
  }
  return `${id}@${getReceivingDomain()}`;
}

/**
 * Recover a ticketId from a recipient address (the inbound webhook's `to`).
 * Accepts a bare address, a "Name <addr>" form, or an array of either (Resend
 * sends `to` as an array). Returns the first local-part that is a valid ObjectId
 * under our receiving domain, or null when none match.
 *
 * @param {string|string[]} to - Recipient(s) from the inbound email.
 * @returns {string|null} The ticketId, or null if no address belongs to us.
 */
export function ticketIdFromRecipients(to) {
  const domain = getReceivingDomain().toLowerCase();
  const list = Array.isArray(to) ? to : [to];

  for (const entry of list) {
    if (!entry) continue;
    // Strip a display-name wrapper: "Portal <id@domain>" -> "id@domain".
    const angle = String(entry).match(/<([^>]+)>/);
    const addr = (angle ? angle[1] : String(entry)).trim().toLowerCase();
    const at = addr.lastIndexOf("@");
    if (at === -1) continue;

    const local = addr.slice(0, at);
    const host = addr.slice(at + 1);
    if (host === domain && OBJECT_ID_RE.test(local)) {
      return local;
    }
  }

  return null;
}
