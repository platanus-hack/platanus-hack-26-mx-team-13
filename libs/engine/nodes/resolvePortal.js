// resolve_portal — figure out which CFDI portal to drive for this merchant.
//
// The merchant identity (a name guess + sometimes the issuing RFC) comes from the
// ticket OCR; the ticket itself almost never carries the facturación URL — and most
// tickets don't print the emisor RFC either, so the merchant NAME is the primary
// join key (the RFC is used when it happens to be present). This node resolves the
// merchant → portal URL in two tiers:
//
//   1. Cache — KnownMerchant is the merchant→portal registry (matched by RFC when
//      present, else by normalized name), the network-effect asset. A hit is instant
//      and free: portalUrl comes straight from the registry and urlSource = "cache".
//      The resolved registry RFC is canonicalized onto state so the recipe lookup +
//      distill stay keyed consistently even when the match was by name.
//   2. Cold discovery — no registry entry yet, so search the web (Firecrawl) for
//      the merchant's facturación portal, persist the winner to KnownMerchant so
//      every later run for this RFC is a cache hit, and report urlSource =
//      "research".
//
// If neither tier yields a URL the run can't proceed: throw NO_URL. It is
// terminal and NOT human-resolvable — a person on the live browser can't conjure
// a portal that doesn't exist.
//
// Discovery degrades gracefully: a missing FIRECRAWL_API_KEY or a Firecrawl
// search outage doesn't crash the run — it just yields no discovered URL, which
// the resolver turns into the same clean terminal NO_URL.
//
// Env (see .env.example):
//   FIRECRAWL_API_KEY - Firecrawl API key for the cold-discovery web search.
//                       Optional: when unset, discovery is skipped (cache-only).

import { INVOICE_STATUS } from "@/libs/engine/state";
import { ENGINE_ERRORS } from "@/libs/engine/errorTypes";
import { engineError } from "@/libs/engine/node";
import connectMongoose from "@/libs/core/mongoose";
import KnownMerchant from "@/models/KnownMerchant";
import MerchantRecipe from "@/models/MerchantRecipe";
import Ticket from "@/models/Ticket";
import { resolveMerchant } from "@/libs/engine/resolveMerchant";
import { normalizeName, nameTokens } from "@/libs/text/normalizeName";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:resolve-portal" });

// Firecrawl web-search endpoint (v2). We call the REST API directly with fetch —
// no SDK dependency, mirroring libs/ocr/googleVision.js.
const FIRECRAWL_SEARCH_ENDPOINT = "https://api.firecrawl.dev/v2/search";

// How many search results to weigh when picking the facturación portal.
const SEARCH_LIMIT = 8;

// Hosts that are never an individual merchant's facturación portal — social
// networks, encyclopedias, and the SAT (the tax authority itself). Scoring drops
// these so a popular non-portal result can't win and poison the shared cache.
const DENY_HOSTS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "linkedin.com",
  "wikipedia.org",
  "reddit.com",
  "tiktok.com",
  "sat.gob.mx",
];

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function resolvePortal(state) {
  const rfcEmisor = (state.rfcEmisor || "").trim();
  const merchantName = (state.merchantName || "").trim();

  // A run needs SOME merchant identity. The issuing RFC is the ideal key, but most
  // tickets don't print it — so the merchant NAME is the primary join key, and a
  // ticket with neither can't be resolved.
  if (!rfcEmisor && !merchantName) {
    throw engineError(
      "No merchant identity on the ticket (neither RFC nor name) — cannot resolve a portal",
      ENGINE_ERRORS.NO_URL.code
    );
  }

  await connectMongoose();

  // 0. QR shortcut — many MX tickets print a QR whose payload IS the facturación
  //    portal URL. When OCR ingestion decoded one it persisted it on the ticket
  //    (extracted.portalUrl + extracted.urlSource:"qr"); that URL is authoritative —
  //    the merchant printed it themselves — so prefer it and SKIP the
  //    KnownMerchant/Firecrawl discovery entirely.
  //
  //    The QR url can reach this node two ways: directly on `state` (if the run
  //    shell ever seeds it) or, the actual path today, on the persisted
  //    Ticket.extracted (the OCR route writes it there — NOT on invoice, which would
  //    seed a "queued" status and block the run start-gate, #104). Read state first,
  //    then fall back to the ticket so this stays robust to the state shape received.
  const qrPortalUrl = await resolveQrPortalUrl(state);
  if (qrPortalUrl) {
    // Stable registry key (same scheme as discovery): RFC when present, else the
    // normalized name uppercased.
    const merchantKey = rfcEmisor
      ? rfcEmisor.toUpperCase()
      : normalizeName(merchantName).toUpperCase();

    // Network effect: persist the QR url to KnownMerchant so a later run for the
    // same merchant whose ticket has NO QR still cache-hits. Best-effort — a write
    // failure must not stop a run that already has its URL from the QR.
    if (merchantKey) {
      const data = { invoiceUrl: qrPortalUrl };
      if (merchantName) {
        data.merchantName = merchantName;
        data.normalizedName = normalizeName(merchantName);
      }
      try {
        await KnownMerchant.upsert(merchantKey, data);
      } catch (err) {
        log.warn("Could not persist QR portal to KnownMerchant", {
          merchantKey,
          error: String(err?.message || err),
        });
      }
    }

    // Load any active recipe for this merchant key, same as the other paths.
    const activeRecipe = merchantKey
      ? await MerchantRecipe.findActiveByRfc(merchantKey)
      : null;
    const recipeFields = activeRecipe
      ? { recipeId: String(activeRecipe._id), recipeVersion: activeRecipe.version }
      : {};

    log.info("Portal resolved from ticket QR", {
      portalUrl: qrPortalUrl,
      merchantKey: merchantKey || null,
    });
    return {
      status: INVOICE_STATUS.RESOLVING_PORTAL,
      portalUrl: qrPortalUrl,
      urlSource: "qr",
      ...(merchantKey ? { rfcEmisor: merchantKey } : {}),
      merchantName: merchantName || null,
      ...recipeFields,
      detail: `QR hit — ${qrPortalUrl}${
        activeRecipe ? ` (recipe v${activeRecipe.version})` : ""
      }`,
    };
  }

  // 1. Cache — resolve the merchant via the shared resolver: exact RFC, else exact
  //    name/alias, else BM25 text search, else AI disambiguation. After the OCR
  //    route's RFC backfill most known merchants arrive with a canonical RFC, so this
  //    is usually a free tier-1 hit; the AI tier only runs on genuinely ambiguous names.
  const resolved = await resolveMerchant({ rfcEmisor, nameGuess: merchantName });
  const known = resolved.merchant;
  const matchedBy = known ? resolved.method : null;

  if (known?.invoiceUrl) {
    // Canonicalize the merchant key to the registry's RFC so the recipe lookup +
    // distill stay keyed consistently — even when we matched purely by name and the
    // ticket carried no RFC. The shell branches on recipeId; recipeUsed stays false
    // until replay_recipe actually succeeds, and replay re-loads the recipe, so one
    // deactivated before replay still falls back to AI.
    const canonicalRfc = known.rfcEmisor;
    const activeRecipe = await MerchantRecipe.findActiveByRfc(canonicalRfc);
    const recipeFields = activeRecipe
      ? { recipeId: String(activeRecipe._id), recipeVersion: activeRecipe.version }
      : {};

    log.info("Portal resolved from cache", {
      rfcEmisor: canonicalRfc,
      matchedBy,
      portalUrl: known.invoiceUrl,
    });
    return {
      status: INVOICE_STATUS.RESOLVING_PORTAL,
      portalUrl: known.invoiceUrl,
      urlSource: "cache",
      rfcEmisor: canonicalRfc,
      merchantName: known.merchantName || merchantName || null,
      ...recipeFields,
      detail: `cache hit (by ${matchedBy}) — ${known.invoiceUrl}${
        activeRecipe ? ` (recipe v${activeRecipe.version})` : ""
      }`,
    };
  }

  // 2. Cold discovery — no registry entry yet. Search the web for the merchant's
  //    facturación portal and persist it under a stable key (the RFC when present,
  //    else a name-derived key) so every later run for this merchant is a cache hit.
  const discovered = await discoverPortal({ rfcEmisor, merchantName });

  if (discovered) {
    // Stable registry key: the RFC when we have it, else the normalized name
    // uppercased (the rfcEmisor field is the merchant key, not necessarily a real RFC).
    const merchantKey = rfcEmisor
      ? rfcEmisor.toUpperCase()
      : normalizeName(merchantName).toUpperCase();

    // Only write fields we actually have, so we never clobber an existing name with null.
    const data = { invoiceUrl: discovered };
    if (merchantName) {
      data.merchantName = merchantName;
      data.normalizedName = normalizeName(merchantName);
    }
    await KnownMerchant.upsert(merchantKey, data);

    const activeRecipe = await MerchantRecipe.findActiveByRfc(merchantKey);
    const recipeFields = activeRecipe
      ? { recipeId: String(activeRecipe._id), recipeVersion: activeRecipe.version }
      : {};

    log.info("Portal discovered and persisted", {
      rfcEmisor: merchantKey,
      portalUrl: discovered,
    });
    return {
      status: INVOICE_STATUS.RESOLVING_PORTAL,
      portalUrl: discovered,
      urlSource: "research",
      rfcEmisor: merchantKey,
      ...recipeFields,
      detail: `discovered + persisted — ${discovered}${
        activeRecipe ? ` (recipe v${activeRecipe.version})` : ""
      }`,
    };
  }

  // 3. Neither cache nor discovery produced a URL → terminal NO_URL.
  throw engineError(
    `No facturación portal found for ${merchantName || rfcEmisor}`,
    ENGINE_ERRORS.NO_URL.code
  );
}

/**
 * Discover a merchant's facturación portal via web search (Firecrawl), returning
 * the best candidate URL or null when nothing convincing is found.
 *
 * Discovery DEGRADES GRACEFULLY: a missing FIRECRAWL_API_KEY or a Firecrawl
 * search outage/error returns null (logged as a warning) instead of throwing.
 * The caller turns a null into a clean terminal NO_URL — a misconfigured or
 * down search becomes "no portal found", not an opaque unhandled crash mid-run.
 *
 * @param {{ rfcEmisor: string, merchantName?: string|null }} args
 * @returns {Promise<string|null>}
 */
async function discoverPortal({ rfcEmisor, merchantName }) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    // Degrade, don't crash: no discovery backend → report nothing found so the
    // caller surfaces a clean NO_URL (cache-only runs still work).
    log.warn(
      "Firecrawl is not configured (FIRECRAWL_API_KEY missing) — skipping discovery, returning null",
      { rfcEmisor }
    );
    return null;
  }

  const query = buildQuery({ rfcEmisor, merchantName });

  // A Firecrawl outage / non-2xx is transient infra, not a merchant decision —
  // swallow it to null so the run ends in a clean NO_URL instead of an
  // unhandled throw escaping the node.
  let results;
  try {
    results = await firecrawlSearch(apiKey, query);
  } catch (err) {
    log.warn("Firecrawl search failed — degrading to no portal found", {
      rfcEmisor,
      query,
      error: String(err?.message || err),
    });
    return null;
  }

  if (!results.length) {
    log.warn("Portal discovery returned no results", { rfcEmisor, query });
    return null;
  }

  return pickPortalUrl(results, merchantName);
}

/**
 * Build the web-search query. The merchant name is the strongest signal, so lead
 * with it and pin the facturación intent; fall back to the RFC when there is no
 * name guess at all.
 *
 * @param {{ rfcEmisor: string, merchantName?: string|null }} args
 * @returns {string}
 */
function buildQuery({ rfcEmisor, merchantName }) {
  const name = (merchantName || "").trim();
  const subject = name || rfcEmisor;
  return `${subject} facturación CFDI portal`;
}

/**
 * Call Firecrawl's search endpoint and return a normalized list of candidates.
 * Throws on a non-2xx response (a search outage is transient, not "no portal").
 *
 * @param {string} apiKey
 * @param {string} query
 * @returns {Promise<Array<{ url: string, title: string, description: string }>>}
 */
async function firecrawlSearch(apiKey, query) {
  const res = await fetch(FIRECRAWL_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, limit: SEARCH_LIMIT }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Firecrawl search error ${res.status}: ${detail.slice(0, 300)}`
    );
  }

  const body = await res.json();
  // v2 nests web results under data.web; tolerate a flat data[] (v1) as well.
  const web = body?.data?.web || (Array.isArray(body?.data) ? body.data : []);

  return web
    .map((r) => ({
      url: r.url || r.sourceURL || r.metadata?.sourceURL || "",
      title: r.title || r.metadata?.title || "",
      description: r.description || r.snippet || r.metadata?.description || "",
    }))
    .filter((r) => r.url);
}

/**
 * Pick the result most likely to be THIS merchant's facturación portal. Returns
 * null when no candidate carries any facturación signal — persisting a generic
 * homepage would poison the shared registry for every later run.
 *
 * @param {Array<{ url: string, title: string, description: string }>} results
 * @param {string|null|undefined} merchantName
 * @returns {string|null}
 */
function pickPortalUrl(results, merchantName) {
  const tokens = nameTokens(merchantName);

  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const score = scoreCandidate(r, tokens);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }

  // bestScore stays 0 only when every candidate is denylisted or carries no
  // facturación signal; in that case `best` is null and we report nothing found.
  if (!best) {
    log.warn("No convincing facturación portal in search results", {
      candidates: results.length,
    });
    return null;
  }
  return best.url;
}

/**
 * Score a candidate by how strongly it looks like the merchant's facturación
 * portal: a dedicated facturación subdomain is the strongest signal, then a
 * facturación path, then the intent appearing in the title/description, plus a
 * bonus when the merchant name shows up in the host (ties the portal to THIS
 * merchant). Denylisted hosts score 0.
 *
 * @param {{ url: string, title: string, description: string }} result
 * @param {string[]} tokens
 * @returns {number}
 */
function scoreCandidate(result, tokens) {
  let host;
  let path;
  try {
    const u = new URL(result.url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return 0; // unparseable URL — skip it
  }

  if (DENY_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return 0;

  const haystack = `${result.title} ${result.description}`.toLowerCase();
  let score = 0;

  // Dedicated facturación subdomain, e.g. factura.merchant.com.
  if (/(^|\.)factura/.test(host)) score += 5;
  // Facturación path on a merchant domain, e.g. /facturacion, /cfdi.
  if (/factura|cfdi/.test(path)) score += 3;
  // Facturación intent anywhere in the title/description.
  if (/factura|cfdi/.test(haystack)) score += 2;
  // Merchant-name overlap with the host.
  for (const token of tokens) {
    if (host.includes(token)) score += 2;
  }

  return score;
}

/**
 * Find a QR-sourced facturación portal URL for this run, if OCR ingestion decoded
 * one. Checks the state first (forward-compatible, if the run shell ever seeds it)
 * then falls back to the persisted Ticket.extracted — where the OCR route writes the
 * QR portal (extracted.portalUrl/urlSource:"qr"; it must NOT live on invoice, which
 * would seed a "queued" status and block the run start-gate — see #104). Only a
 * urlSource of "qr" counts (a cache / research url is resolve_portal's own output).
 *
 * Best-effort: a Ticket read failure (or no ticketId) returns null so the resolver
 * falls through to normal cache/discovery rather than crashing.
 *
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<string|null>}
 */
async function resolveQrPortalUrl(state) {
  // 1. Already on state (e.g. a future run shell that seeds the QR fields).
  if (state?.urlSource === "qr" && isHttpUrl(state.portalUrl)) {
    return state.portalUrl.trim();
  }

  // 2. Fall back to the persisted ticket — where the OCR route actually wrote it.
  if (!state?.ticketId) return null;
  try {
    const ticket = await Ticket.findById(state.ticketId).select("extracted").lean();
    const extracted = ticket?.extracted;
    if (extracted?.urlSource === "qr" && isHttpUrl(extracted.portalUrl)) {
      return extracted.portalUrl.trim();
    }
  } catch (err) {
    log.warn("Could not read ticket for QR portal lookup", {
      ticketId: state.ticketId,
      error: String(err?.message || err),
    });
  }
  return null;
}

/** True when value is a non-empty http(s) URL. */
function isHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default resolvePortal;
