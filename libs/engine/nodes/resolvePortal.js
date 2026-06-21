// resolve_portal — figure out which CFDI portal to drive for this merchant.
//
// The merchant identity (rfcEmisor + a name guess) comes from the ticket OCR;
// the ticket itself almost never carries the facturación URL. This node resolves
// rfcEmisor → portal URL in two tiers:
//
//   1. Cache — KnownMerchant is the RFC→portal registry, the network-effect
//      asset. A hit is instant and free: portalUrl comes straight from the
//      registry and urlSource = "cache".
//   2. Cold discovery — no registry entry yet, so search the web (Firecrawl) for
//      the merchant's facturación portal, persist the winner to KnownMerchant so
//      every later run for this RFC is a cache hit, and report urlSource =
//      "research".
//
// If neither tier yields a URL the run can't proceed: throw NO_URL. It is
// terminal and NOT human-resolvable — a person on the live browser can't conjure
// a portal that doesn't exist.
//
// Env (see .env.example):
//   FIRECRAWL_API_KEY - Firecrawl API key for the cold-discovery web search.

import { INVOICE_STATUS } from "@/libs/engine/state";
import { ENGINE_ERRORS } from "@/libs/engine/errorTypes";
import { engineError } from "@/libs/engine/node";
import connectMongoose from "@/libs/core/mongoose";
import KnownMerchant from "@/models/KnownMerchant";
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
  const rfcEmisor = state.rfcEmisor;
  if (!rfcEmisor) {
    // No merchant key → nothing to resolve against. Terminal.
    throw engineError(
      "No merchant RFC on the ticket — cannot resolve a portal",
      ENGINE_ERRORS.NO_URL.code
    );
  }

  await connectMongoose();

  // 1. Cache: a known merchant resolves instantly from the registry.
  const known = await KnownMerchant.findByRfc(rfcEmisor);
  if (known?.invoiceUrl) {
    log.info("Portal resolved from cache", {
      rfcEmisor,
      portalUrl: known.invoiceUrl,
    });
    return {
      status: INVOICE_STATUS.RESOLVING_PORTAL,
      portalUrl: known.invoiceUrl,
      urlSource: "cache",
      detail: `cache hit — ${known.invoiceUrl}`,
    };
  }

  // 2. Cold discovery: search the web for this merchant's facturación portal.
  const discovered = await discoverPortal({
    rfcEmisor,
    merchantName: state.merchantName,
  });

  if (discovered) {
    // Persist so this RFC is a cache hit on every later run (the network effect).
    // Only write fields we actually have, so we never clobber an existing
    // merchant name with null.
    const data = { invoiceUrl: discovered };
    if (state.merchantName) {
      data.merchantName = state.merchantName;
      data.normalizedName = normalizeName(state.merchantName);
    }
    await KnownMerchant.upsert(rfcEmisor, data);

    log.info("Portal discovered and persisted", {
      rfcEmisor,
      portalUrl: discovered,
    });
    return {
      status: INVOICE_STATUS.RESOLVING_PORTAL,
      portalUrl: discovered,
      urlSource: "research",
      detail: `discovered + persisted — ${discovered}`,
    };
  }

  // 3. Neither cache nor discovery produced a URL → terminal NO_URL.
  throw engineError(
    `No facturación portal found for ${rfcEmisor}`,
    ENGINE_ERRORS.NO_URL.code
  );
}

/**
 * Discover a merchant's facturación portal via web search (Firecrawl), returning
 * the best candidate URL or null when nothing convincing is found.
 *
 * Requires FIRECRAWL_API_KEY; a missing key is a configuration error (throws),
 * not a "not found" — so misconfiguration fails loudly instead of masquerading
 * as a merchant with no portal.
 *
 * @param {{ rfcEmisor: string, merchantName?: string|null }} args
 * @returns {Promise<string|null>}
 */
async function discoverPortal({ rfcEmisor, merchantName }) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Firecrawl is not configured — set FIRECRAWL_API_KEY in .env.local"
    );
  }

  const query = buildQuery({ rfcEmisor, merchantName });
  const results = await firecrawlSearch(apiKey, query);

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
  const nameTokens = nameTokensOf(merchantName);

  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const score = scoreCandidate(r, nameTokens);
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
 * @param {string[]} nameTokens
 * @returns {number}
 */
function scoreCandidate(result, nameTokens) {
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
  for (const token of nameTokens) {
    if (host.includes(token)) score += 2;
  }

  return score;
}

/**
 * Split a merchant name into lowercased, accent-stripped tokens worth matching
 * against a hostname. Short tokens (de, la, sa, cv, …) are dropped as noise.
 *
 * @param {string|null|undefined} merchantName
 * @returns {string[]}
 */
function nameTokensOf(merchantName) {
  return normalizeName(merchantName)
    .split(" ")
    .filter((t) => t.length >= 4);
}

/**
 * Normalize a name for fuzzy matching and for KnownMerchant.normalizedName:
 * lowercase, strip diacritics, drop punctuation, collapse whitespace.
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default resolvePortal;
