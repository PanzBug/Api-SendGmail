import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_keys (
  key TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  duration TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  usage_limit INT,
  usage_count INT NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_last_hit ON api_keys(last_hit_at);

CREATE TABLE IF NOT EXISTS gmails (
  email TEXT PRIMARY KEY,
  app_password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS targets (
  username TEXT PRIMARY KEY,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS banding_sessions (
  chat_id TEXT PRIMARY KEY,
  step INTEGER NOT NULL DEFAULT 0,
  account_name TEXT,
  telegram_id TEXT,
  profile_link TEXT,
  profile_photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_logs (
  id SERIAL PRIMARY KEY,
  gmail_user TEXT NOT NULL,
  gmail_app_password TEXT NOT NULL,
  last_notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gmail_user, gmail_app_password)
);
`;

// tambahan idempotent untuk DB lama yang dibuat sebelum kolom limit ada
// ponytail: dijalankan setiap connectDB, bukan cuma init pertama — agar ALTER tetap jalan walau initPromise sudah tercache lama
const ENSURE_APIKEY_COLS = `
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_limit INT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_count INT NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_api_keys_last_hit ON api_keys(last_hit_at);
`;

function getPool() {
  if (global.__pgPool) return global.__pgPool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Define DATABASE_URL');
  if (!global.__pgPool) {
    global.__pgPool = new pg.Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
  }
  return global.__pgPool;
}

let initPromise;
let ensurePromise;

async function connectDB() {
  const pool = getPool();
  if (!initPromise) {
    initPromise = pool.query(SCHEMA).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
  // selalu pastikan kolom baru ada — untuk DB yang dibuat sebelum fitur limit
  // di-cache per-proses tapi tetap dijalankan setidaknya sekali setelah deploy baru
  if (!ensurePromise) {
    ensurePromise = pool.query(ENSURE_APIKEY_COLS).catch((err) => {
      // jika tabel belum ada (fresh DB), error bisa diabaikan karena SCHEMA sudah buat
      console.warn('[connectDB] ensure cols warn:', err.message);
    });
  }
  await ensurePromise;
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

export { getPool };

export default connectDB;
