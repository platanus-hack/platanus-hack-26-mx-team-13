// Thin console wrapper. No pino (not installed) — keep dependencies minimal.
// Returns the standard four levels, each prefixed with the component name so
// logs are greppable: `[ocr:download] INFO  Downloading image`.

const LEVELS = ["debug", "info", "warn", "error"];

// `debug` is silenced in production to keep logs quiet; everything else always prints.
const isProd = process.env.NODE_ENV === "production";

function format(level, component) {
  const tag = component ? `[${component}]` : "";
  const label = level.toUpperCase().padEnd(5);
  // console.error / console.warn route to stderr; debug/info to stdout.
  const sink =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;

  return (...args) => {
    if (level === "debug" && isProd) return;
    sink(`${tag} ${label}`.trim(), ...args);
  };
}

/**
 * Create a component-scoped logger.
 * @param {Object} [opts]
 * @param {string} [opts.component] - Label prefixed on every line (e.g. 'ocr:download').
 * @returns {{ info: Function, warn: Function, error: Function, debug: Function }}
 *
 * @example
 * const log = createLogger({ component: 'mongoose' });
 * log.info('connected'); // [mongoose] INFO  connected
 */
export function createLogger({ component } = {}) {
  return LEVELS.reduce((logger, level) => {
    logger[level] = format(level, component);
    return logger;
  }, {});
}

export default createLogger;
