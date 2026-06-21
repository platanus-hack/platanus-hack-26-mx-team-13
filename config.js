// Minimal app config. Only what auth + models reference today.
// Expand intentionally as features land — keep this lean.
const config = {
  // App display name (auth emails, UI).
  appName: "Facturin",
  // Naked domain, no protocol, no trailing slash.
  domainName: "facturin.mx",
  colors: {
    // Primary brand color.
    main: "#16a34a",
  },
  resend: {
    // 'From' field used when sending magic login links and invoice-delivery mail.
    fromNoReply: "Facturin <noreply@facturin.mx>",
    // Catch-all subdomain for INBOUND CFDI delivery. When a merchant portal mails
    // the invoice instead of offering a download, the fill step writes
    // `<ticketId>@<receivingDomain>` into the portal's email field so we receive
    // the XML/PDF. One MX record on this subdomain serves every ticket.
    // Override at runtime with RESEND_RECEIVING_DOMAIN.
    receivingDomain: "facturas.facturin.mx",
  },
};

export default config;
