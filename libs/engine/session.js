import { Stagehand } from "@browserbasehq/stagehand";
import Browserbase from "@browserbasehq/sdk";
import { createLogger } from "@/libs/core/logger";
import { putObjectBuffer } from "@/libs/storage/r2";

// Engine browser-session layer — cloud browsers via Browserbase + Stagehand.
//
// Browsers can't run on Vercel, so the engine drives a browser that lives on
// Browserbase. A session is cloud-side state: we track its `sessionId` and
// `connectUrl` (NOT a local browser instance) so the engine — and later a human
// taking over (HITL) — can reconnect to the SAME session. createSession opens a
// keepAlive session that survives the script that started it; reconnectSession
// re-attaches to it (mind Browserbase's ~10-min CDP idle timeout). The session
// identity is persisted on Ticket.invoice (browserbaseSessionId, connectUrl).
//
// keepAlive requires a paid Browserbase plan. Local development MAY run a headed
// LOCAL browser instead (set ENGINE_LOCAL_BROWSER=true); production is always
// BROWSERBASE.
//
// Env (see .env.example):
//   BROWSERBASE_API_KEY    - Browserbase API key (server-only)
//   BROWSERBASE_PROJECT_ID - Browserbase project to create sessions in
//   ENGINE_LOCAL_BROWSER   - "true" → headed LOCAL browser for local dev (optional)

const log = createLogger({ component: "engine:session" });

// Keep the session alive for up to an hour and let it outlive the script that
// created it, so a later node — or a human via HITL — can reconnect.
const SESSION_TIMEOUT_SECONDS = 3600;

// LLM that powers Stagehand's instance-level act()/observe()/extract() (the AI
// fill path). Stagehand v3 otherwise defaults to "openai/gpt-4.1-mini", which both
// needs an OPENAI_API_KEY and silently bypasses Claude — pin it to Anthropic (the
// "anthropic/" prefix auto-loads ANTHROPIC_API_KEY from the env, same as the
// reach_form agent). Override with ENGINE_LLM_MODEL (e.g. anthropic/claude-sonnet-4-6
// for higher-fidelity extraction).
const ENGINE_MODEL = process.env.ENGINE_LLM_MODEL || "anthropic/claude-haiku-4-5";

/** Whether to drive a local headed browser instead of Browserbase (dev only). */
function isLocal() {
  return process.env.ENGINE_LOCAL_BROWSER === "true";
}

/** Read a required env var or throw a clear, actionable error. */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Browserbase is not configured — set ${name} in .env.local (or ENGINE_LOCAL_BROWSER=true for local dev)`
    );
  }
  return value;
}

// Cache the Browserbase REST client on globalThis so Next.js dev hot-reload
// reuses one instance instead of constructing a new client per module re-eval.
function getBrowserbase() {
  if (globalThis._bbClient) return globalThis._bbClient;
  globalThis._bbClient = new Browserbase({
    apiKey: requireEnv("BROWSERBASE_API_KEY"),
  });
  return globalThis._bbClient;
}

/** Read the Browserbase session id off a Stagehand instance (v3 exposes both). */
function sessionIdOf(stagehand) {
  return stagehand?.browserbaseSessionID || stagehand?.sessionId || null;
}

/**
 * Best-effort fetch of a session's live connect URL (the CDP endpoint a human or
 * another process reconnects through). Returns null if it can't be retrieved —
 * the session is still usable; only HITL resume loses its shortcut.
 */
async function retrieveConnectUrl(sessionId) {
  if (!sessionId) return null;
  try {
    const session = await getBrowserbase().sessions.retrieve(sessionId);
    return session?.connectUrl || null;
  } catch (err) {
    log.warn("Could not retrieve connectUrl", { sessionId, error: String(err) });
    return null;
  }
}

/**
 * Extract a Browserbase session id from either a raw id or a connectUrl that
 * carries `sessionId=` as a query param. reconnectSession accepts either.
 */
function extractSessionId(sessionIdOrConnectUrl) {
  const value = sessionIdOrConnectUrl;
  if (typeof value !== "string") return value;
  if (value.includes("sessionId=")) {
    try {
      return new URL(value).searchParams.get("sessionId") || value;
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Open a fresh browser session and return the running Stagehand plus the
 * cloud-side identity to persist on the ticket.
 *
 * In production this creates a keepAlive Browserbase session (timeout 1h) so it
 * outlives the current run and a later node or human can reconnect. In local dev
 * (ENGINE_LOCAL_BROWSER=true) it launches a headed local browser, with no
 * sessionId/connectUrl to track.
 *
 * @param {Object} [opts]
 * @param {string} [opts.ticketId] - Ticket this session is invoicing; tagged as
 *   session metadata so cloud sessions are traceable back to a ticket.
 * @returns {Promise<{ stagehand: import("@browserbasehq/stagehand").Stagehand, sessionId: string|null, connectUrl: string|null }>}
 */
export async function createSession({ ticketId } = {}) {
  const local = isLocal();

  const stagehand = local
    ? new Stagehand({
        env: "LOCAL",
        model: ENGINE_MODEL,
        localBrowserLaunchOptions: { headless: false },
      })
    : new Stagehand({
        env: "BROWSERBASE",
        model: ENGINE_MODEL,
        apiKey: requireEnv("BROWSERBASE_API_KEY"),
        projectId: requireEnv("BROWSERBASE_PROJECT_ID"),
        browserbaseSessionCreateParams: {
          keepAlive: true,
          timeout: SESSION_TIMEOUT_SECONDS,
          ...(ticketId
            ? { userMetadata: { ticketId: String(ticketId) } }
            : {}),
        },
      });

  await stagehand.init();

  const sessionId = local ? null : sessionIdOf(stagehand);
  const connectUrl = local ? null : await retrieveConnectUrl(sessionId);

  log.info("Session created", { env: local ? "LOCAL" : "BROWSERBASE", ticketId, sessionId });

  return { stagehand, sessionId, connectUrl };
}

/**
 * Re-attach to an existing keepAlive Browserbase session (HITL resume, or a
 * later engine node picking the run back up). Accepts the raw session id or a
 * connectUrl. The session must still be alive — Browserbase drops idle CDP
 * connections after ~10 minutes, so reconnect promptly.
 *
 * @param {string} sessionIdOrConnectUrl - Browserbase session id or its connectUrl.
 * @returns {Promise<{ stagehand: import("@browserbasehq/stagehand").Stagehand, sessionId: string, connectUrl: string|null }>}
 */
export async function reconnectSession(sessionIdOrConnectUrl) {
  if (!sessionIdOrConnectUrl) {
    throw new Error("reconnectSession: a sessionId or connectUrl is required");
  }

  const sessionId = extractSessionId(sessionIdOrConnectUrl);

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    model: ENGINE_MODEL,
    apiKey: requireEnv("BROWSERBASE_API_KEY"),
    projectId: requireEnv("BROWSERBASE_PROJECT_ID"),
    browserbaseSessionID: sessionId,
    // keepAlive so stagehand.close() only drops the LOCAL CDP handle. Without it
    // Stagehand defaults keepAlive=false and close() calls apiClient.end(), which
    // TERMINATES the shared Browserbase session — stranding the next node (AI
    // fallback / later node / HITL) that must reconnect to the SAME session.
    // Mirrors createSession, which keeps the session alive the same way.
    keepAlive: true,
  });

  await stagehand.init();

  const connectUrl = await retrieveConnectUrl(sessionId);

  log.info("Session reconnected", { sessionId });

  return { stagehand, sessionId, connectUrl };
}

/**
 * Resolve the live page to drive from a running Stagehand session.
 *
 * Stagehand v3 has NO `stagehand.page` accessor — pages live on the CDP-backed
 * context (stagehand.context). Return the most-recent active page, falling back
 * to the first open page; throw a clear error when the session exposes no page so
 * a node fails loudly instead of dereferencing `undefined` mid-navigation.
 *
 * @param {import("@browserbasehq/stagehand").Stagehand} stagehand - A live session.
 * @returns {import("playwright").Page} The active Stagehand page.
 */
export function getActivePage(stagehand) {
  const context = stagehand?.context;
  const page =
    (typeof context?.activePage === "function" && context.activePage()) ||
    (typeof context?.pages === "function" && context.pages()[0]) ||
    null;
  if (!page) {
    throw new Error("Stagehand session has no active page to drive");
  }
  return page;
}

/**
 * Get the embeddable, interactive live-view URL for a session — the fullscreen
 * debugger a human watches (and drives) during HITL takeover.
 *
 * @param {string} sessionId - Browserbase session id.
 * @returns {Promise<string|null>} debuggerFullscreenUrl, or null if unavailable.
 */
export async function getLiveViewUrl(sessionId) {
  if (!sessionId) throw new Error("getLiveViewUrl: a sessionId is required");
  const debug = await getBrowserbase().sessions.debug(sessionId);
  return debug?.debuggerFullscreenUrl || null;
}

/**
 * Release a keepAlive session so Browserbase stops billing for it. keepAlive
 * sessions don't close on their own when the script ends — they must be
 * explicitly released. No-op-safe for local sessions (they have no id).
 *
 * @param {string} sessionId - Browserbase session id.
 * @returns {Promise<void>}
 */
export async function closeSession(sessionId) {
  if (!sessionId) return;
  await getBrowserbase().sessions.update(sessionId, {
    projectId: requireEnv("BROWSERBASE_PROJECT_ID"),
    status: "REQUEST_RELEASE",
  });
  log.info("Session released", { sessionId });
}

/**
 * Capture a screenshot of the current page and store it in R2, returning a
 * Screenshot descriptor (see libs/engine/state.js) to append to
 * InvoiceState.screenshots.
 *
 * @param {import("playwright").Page} page - The Stagehand page (getActivePage()).
 * @param {string} ticketId - Ticket the run belongs to (R2 key prefix).
 * @param {string} [label] - What the shot shows (e.g. 'form', 'error').
 * @returns {Promise<{ key: string, label: string|null, at: string }>}
 */
export async function screenshotToR2(page, ticketId, label) {
  if (!page) throw new Error("screenshotToR2: a page is required");

  const buffer = await page.screenshot();
  const at = new Date().toISOString();
  const safeLabel = String(label || "shot")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const key = `engine/${ticketId || "unknown"}/${Date.now()}-${safeLabel}.png`;

  await putObjectBuffer({ key, body: buffer, contentType: "image/png" });

  log.info("Screenshot stored", { ticketId, key });

  return { key, label: label || null, at };
}
