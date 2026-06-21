// init_navigate — open the Browserbase session and navigate to the portal.
//
// Opens a cloud browser via createSession (#57), drives it to the resolved
// portalUrl, and captures a screenshot to R2. The session is keepAlive, so on
// success we drop only our local handle (stagehand.close()) and persist the
// reconnectable browserbaseSessionId + connectUrl: a later node — or a human via
// HITL — re-attaches to the SAME cloud session. On failure we release the
// session so a leaked keepAlive session doesn't keep billing.
//
// Portals are flaky and often published under slightly different URLs (http vs
// https, www vs bare host), so navigation tries a few URL variants before giving
// up. A goto timeout → NAVIGATION_TIMEOUT; an HTTP error / blank / unreachable
// page → PAGE_BROKEN. The shell (processInvoice.js) retries this node.

import { INVOICE_STATUS } from "@/libs/engine/state";
import { ENGINE_ERRORS } from "@/libs/engine/errorTypes";
import { engineError } from "@/libs/engine/node";
import {
  createSession,
  closeSession,
  screenshotToR2,
  getActivePage,
} from "@/libs/engine/session";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:init-navigate" });

// Per the engine spec: a portal must load within 15s or we treat it as timed out.
const NAV_TIMEOUT_MS = 15000;

/**
 * Build the ordered list of URLs to try for a portal. Merchants publish the same
 * portal under slightly different forms, so we fall back from the given URL to an
 * https-forced variant and a www-toggled host before failing.
 *
 * @param {string} rawUrl - The resolved portalUrl (may lack a scheme).
 * @returns {string[]} Unique candidate URLs, most-likely first.
 */
function buildUrlVariants(rawUrl) {
  const variants = [];
  const seen = new Set();
  const push = (url) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      variants.push(url);
    }
  };

  const raw = String(rawUrl || "").trim();
  if (!raw) return variants;

  // Ensure a scheme so the URL parses and page.goto accepts it.
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  push(withProto);

  let parsed;
  try {
    parsed = new URL(withProto);
  } catch {
    // Un-parseable — just try it verbatim.
    return variants;
  }

  // Force https: some portals serve plain http but block or misbehave on it.
  if (parsed.protocol === "http:") {
    const https = new URL(parsed.toString());
    https.protocol = "https:";
    push(https.toString());
  }

  // Toggle the www. prefix — the portal may live under either host.
  const host = parsed.hostname;
  const toggledHost = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  const toggled = new URL(parsed.toString());
  toggled.hostname = toggledHost;
  push(toggled.toString());

  return variants;
}

/**
 * Try each URL variant in order. Returns the first that loads with an OK status;
 * throws a typed engineError (NAVIGATION_TIMEOUT or PAGE_BROKEN) if none do.
 *
 * @param {import("playwright").Page} page - The Stagehand page.
 * @param {string[]} variants - Candidate URLs from buildUrlVariants.
 * @returns {Promise<{ url: string, httpStatus: number|null }>}
 */
async function navigateWithFallback(page, variants) {
  let lastErrorType = ENGINE_ERRORS.NAVIGATION_TIMEOUT.code;
  let lastDetail = "no navigation attempt was made";

  for (const url of variants) {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      // No response object means a blank/aborted load; a >=400 status means the
      // portal answered but this URL is unusable. Either way the page is broken
      // at this variant — remember why and try the next one.
      if (!response) {
        lastErrorType = ENGINE_ERRORS.PAGE_BROKEN.code;
        lastDetail = `no response from ${url}`;
        continue;
      }
      const httpStatus = response.status();
      if (httpStatus >= 400) {
        lastErrorType = ENGINE_ERRORS.PAGE_BROKEN.code;
        lastDetail = `HTTP ${httpStatus} from ${url}`;
        continue;
      }

      return { url, httpStatus };
    } catch (err) {
      const message = err && err.message ? String(err.message) : String(err);
      // Playwright throws a TimeoutError when goto exceeds the deadline; anything
      // else (DNS failure, connection refused, TLS error) is an unreachable /
      // broken page.
      const isTimeout =
        (err && err.name === "TimeoutError") || /timeout/i.test(message);
      lastErrorType = isTimeout
        ? ENGINE_ERRORS.NAVIGATION_TIMEOUT.code
        : ENGINE_ERRORS.PAGE_BROKEN.code;
      lastDetail = message;
    }
  }

  throw engineError(
    `Could not navigate to the portal (${lastDetail})`,
    lastErrorType
  );
}

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function initNavigate(state) {
  const variants = buildUrlVariants(state.portalUrl);
  if (variants.length === 0) {
    // resolve_portal is supposed to guarantee a URL before this node runs; guard
    // anyway so a missing URL fails with a clear, classified error.
    throw engineError("No portal URL to navigate to", ENGINE_ERRORS.NO_URL.code);
  }

  // createSession may throw on misconfig (no Browserbase env) — let that surface
  // before we have anything to clean up.
  const { stagehand, sessionId, connectUrl } = await createSession({
    ticketId: state.ticketId,
  });

  let succeeded = false;
  try {
    // Stagehand v3 has no stagehand.page — resolve the live page off the context.
    const page = getActivePage(stagehand);
    const { url, httpStatus } = await navigateWithFallback(page, variants);

    // Capture what we landed on. Best-effort: a screenshot failure must not sink
    // an otherwise-successful navigation.
    let screenshots = state.screenshots || [];
    try {
      const shot = await screenshotToR2(page, state.ticketId, "navigated");
      screenshots = [...screenshots, shot];
    } catch (err) {
      log.warn("Screenshot failed after navigation", {
        ticketId: state.ticketId,
        error: String(err),
      });
    }

    succeeded = true;
    return {
      status: INVOICE_STATUS.NAVIGATING,
      browserbaseSessionId: sessionId,
      connectUrl,
      screenshots,
      detail: `navigated to ${url}${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
    };
  } finally {
    // Drop our local CDP handle. On a BROWSERBASE session keepAlive keeps the cloud
    // session running, so a later node reconnects via the persisted id/connectUrl. A
    // LOCAL dev browser (no id) is intentionally left open ON SUCCESS for inspection —
    // but on FAILURE we still close it, or the shell's NAV retries orphan a headed
    // Chrome window per attempt.
    if (sessionId || !succeeded) {
      await stagehand
        .close()
        .catch((err) =>
          log.warn("Failed to close session handle", {
            ticketId: state.ticketId,
            sessionId,
            error: String(err),
          })
        );
    }
    // On a BROWSERBASE failure, also release the cloud session so a leaked keepAlive
    // session doesn't keep billing — the shell's retry opens a fresh one.
    if (sessionId && !succeeded) {
      await closeSession(sessionId).catch((err) =>
        log.warn("Failed to release session after navigation failure", {
          ticketId: state.ticketId,
          sessionId,
          error: String(err),
        })
      );
    }
  }
}

export default initNavigate;
