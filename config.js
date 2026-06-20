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
    // 'From' field used when sending magic login links.
    fromNoReply: "Facturin <noreply@facturin.mx>",
  },
};

export default config;
