// ponytail: tiny logger, no dep — one helper for all endpoints
export function maskKey(k) {
  if (!k || typeof k !== 'string') return '(empty)';
  if (k.length <= 8) return '***';
  return `${k.slice(0, 6)}***${k.slice(-4)}`;
}
export function maskEmail(e) {
  if (!e || typeof e !== 'string') return '(empty)';
  const at = e.indexOf('@');
  if (at <= 1) return '***' + e.slice(at);
  return e[0] + '***' + e.slice(at);
}
function ts() { return new Date().toISOString(); }

export function createLogger(scope) {
  const p = `[${scope}]`;
  return {
    info: (msg, ctx) => {
      if (ctx !== undefined) console.info(`${ts()} ${p}[INFO] ${msg}`, ctx);
      else console.info(`${ts()} ${p}[INFO] ${msg}`);
    },
    warn: (msg, ctx) => {
      if (ctx !== undefined) console.warn(`${ts()} ${p}[WARN] ${msg}`, ctx);
      else console.warn(`${ts()} ${p}[WARN] ${msg}`);
    },
    error: (msg, ctx) => {
      if (ctx !== undefined) console.error(`${ts()} ${p}[ERROR] ${msg}`, ctx);
      else console.error(`${ts()} ${p}[ERROR] ${msg}`);
    },
  };
}
