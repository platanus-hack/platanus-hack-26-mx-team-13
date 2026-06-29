// Portal-driver registry — merchants that get a hand-authored deterministic driver
// instead of the generic recipe replay.
//
// Some portals (heavy PrimeFaces SPAs like OXXO) can't be expressed as a flat list
// of fill/click steps: they need a readonly datepicker operated by clicking days, a
// validation gate that must be observed before the fiscal form unlocks, and
// selectOneMenu overlays chosen by option text. Those merchants get a driver keyed
// by issuing RFC; the engine prefers it over reach_form/replay/fill (see
// trigger/processInvoice.js). Everything else stays on the generic recipe path.

import { driveOxxoToDownload, OXXO_RFC } from "./oxxo.js";
import { driveAlsuperToDownload, ALSUPER_RFC } from "./alsuper.js";

// Issuing RFC (the canonical merchant key resolve_portal produces) → driver.
const DRIVERS = Object.freeze({
  [OXXO_RFC]: driveOxxoToDownload,
  [ALSUPER_RFC]: driveAlsuperToDownload,
});

/**
 * The deterministic portal driver for a merchant, or null when none exists (the
 * run then falls back to the generic recipe/AI fill path).
 *
 * @param {string|null|undefined} rfcEmisor - canonical merchant key (issuing RFC).
 * @returns {((page: import("playwright").Page, data: object) => Promise<{validated:boolean,generated:boolean,reachedDownload:boolean}>)|null}
 */
export function getPortalDriver(rfcEmisor) {
  if (!rfcEmisor) return null;
  return DRIVERS[String(rfcEmisor).toUpperCase()] || null;
}

export default getPortalDriver;
