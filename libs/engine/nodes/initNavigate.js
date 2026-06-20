// init_navigate — open the Browserbase session and navigate to the portal.
//
// STUB. This is the Browserbase + Stagehand session layer (issue title): the real
// node creates a keepAlive Browserbase session, records its sessionId and a Live
// View connectUrl (for human takeover / inspection), then drives the browser to
// portalUrl. For now it returns placeholder session identifiers so the shell's
// navigation step (and its retry counter) runs end-to-end.

import { INVOICE_STATUS } from "@/libs/engine/state";

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function initNavigate(state) {
  return {
    status: INVOICE_STATUS.NAVIGATING,
    browserbaseSessionId: state.browserbaseSessionId || "stub-session",
    connectUrl: state.connectUrl || "https://example.invalid/live-view",
    detail: "stub: opened browser session and navigated to portal",
  };
}

export default initNavigate;
