import connectDB, { getPool } from '../utils/connectDB.js';
import { createLogger, maskKey } from '../utils/logger.js';
const log = createLogger('migrate');

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  const t0 = Date.now();
  log.info(`Request start method=${req.method} ip=${req.ip || req.headers['x-forwarded-for'] || '-'}`);
  // hanya admin yang boleh
  const adminKey = req.headers['x-admin-key'] || req.query.secret;
  if (adminKey !== process.env.ADMIN_API_KEY && adminKey !== process.env.CRON_SECRET) {
    log.warn(`Unauthorized migrate attempt key=${adminKey ? maskKey(adminKey)+' (salah)' : '(empty)'}`);
    return res.status(401).json({ error: 'Unauthorized', hint: 'Use x-admin-key: ADMIN_API_KEY or ?secret=CRON_SECRET' });
  }
  log.info(`Auth ok mode=${req.headers['x-admin-key'] ? 'admin-key' : 'cron-secret'}`);
  try {
    const pool = getPool();
    // paksa connectDB dulu untuk SCHEMA
    await connectDB();
    const stmts = [
      `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_limit INT`,
      `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_count INT NOT NULL DEFAULT 0`,
      `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ`,
      `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_last_hit ON api_keys(last_hit_at)`,
    ];
    const results = [];
    for (const sql of stmts) {
      try { await pool.query(sql); results.push({ sql, ok: true }); log.info(`Migrate ok: ${sql.slice(0,60)}`); }
      catch (e) { results.push({ sql, ok: false, error: e.message }); log.warn(`Migrate fail: ${sql.slice(0,60)} error=${e.message}`); }
    }
    // cek kolom sekarang
    const { rows } = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name='api_keys' AND column_name IN ('usage_limit','usage_count','last_hit_at','updated_at')
      ORDER BY column_name
    `);
    log.info(`Migrate done columns=${rows.map(r=>r.column_name).join(',')} dur=${Date.now()-t0}ms`);
    return res.status(200).json({ success: true, results, columns: rows });
  } catch (e) {
    log.error(`Migrate error: ${e.message}`, { stack: e.stack?.slice(0,1200) });
    return res.status(500).json({ error: e.message });
  }
}
