import { query, getPool } from '../utils/connectDB.js';

const COLS = `key, email, duration, expires_at AS "expiresAt", is_active AS "isActive", created_at AS "createdAt", usage_limit AS "usageLimit", usage_count AS "usageCount", last_hit_at AS "lastHitAt", updated_at AS "updatedAt"`;

// fallback cols untuk DB lama yang belum migrasi (tanpa last_hit_at dll) — dipakai saat retry
const COLS_LEGACY = `key, email, duration, expires_at AS "expiresAt", is_active AS "isActive", created_at AS "createdAt"`;

const THROTTLE_MS = 5000;

function getResetAtWIB() {
  // next midnight WIB (Asia/Jakarta UTC+7) as ISO with +07:00
  const nowUtcMs = Date.now();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNowMs = nowUtcMs + wibOffset;
  const dayMs = 24 * 60 * 60 * 1000;
  const nextMidnightWibMs = Math.ceil((wibNowMs + 1) / dayMs) * dayMs;
  const nextMidnightUtcMs = nextMidnightWibMs - wibOffset;
  const d = new Date(nextMidnightUtcMs);
  // format as 2026-09-04T00:00:00+07:00
  const wib = new Date(d.getTime() + wibOffset);
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = wib.getUTCFullYear();
  const mm = pad(wib.getUTCMonth() + 1);
  const dd = pad(wib.getUTCDate());
  return `${yyyy}-${mm}-${dd}T00:00:00+07:00`;
}

function isMissingColError(err) {
  const msg = String(err?.message || '');
  return msg.includes('column') && msg.includes('does not exist') && (msg.includes('last_hit_at') || msg.includes('usage_limit') || msg.includes('usage_count') || msg.includes('updated_at'));
}

async function ensureCols() {
  const pool = getPool();
  const sql = `
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_limit INT;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_count INT NOT NULL DEFAULT 0;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    CREATE INDEX IF NOT EXISTS idx_api_keys_last_hit ON api_keys(last_hit_at);
  `;
  try { await pool.query(sql); } catch (e) { console.warn('[ApiKey] ensureCols warn:', e.message); }
}

export const ApiKey = {
  async findOneActive(key) {
    try {
      const { rows } = await query(`SELECT ${COLS} FROM api_keys WHERE key = $1 AND is_active = true`, [key]);
      return rows[0] || null;
    } catch (e) {
      if (isMissingColError(e)) {
        console.warn('[ApiKey] missing col, migrating...');
        await ensureCols();
        // retry dengan COLS setelah migrasi; jika masih gagal, fallback ke legacy agar API tetap jalan (tanpa limit)
        try {
          const { rows } = await query(`SELECT ${COLS} FROM api_keys WHERE key = $1 AND is_active = true`, [key]);
          return rows[0] || null;
        } catch {
          const { rows } = await query(`SELECT ${COLS_LEGACY} FROM api_keys WHERE key = $1 AND is_active = true`, [key]);
          return rows[0] ? { ...rows[0], usageLimit: null, usageCount: 0, lastHitAt: null, updatedAt: null } : null;
        }
      }
      throw e;
    }
  },
  async findOneByKey(key) {
    try {
      const { rows } = await query(`SELECT ${COLS} FROM api_keys WHERE key = $1`, [key]);
      return rows[0] || null;
    } catch (e) {
      if (isMissingColError(e)) {
        await ensureCols();
        try {
          const { rows } = await query(`SELECT ${COLS} FROM api_keys WHERE key = $1`, [key]);
          return rows[0] || null;
        } catch {
          const { rows } = await query(`SELECT ${COLS_LEGACY} FROM api_keys WHERE key = $1`, [key]);
          return rows[0] ? { ...rows[0], usageLimit: null, usageCount: 0, lastHitAt: null, updatedAt: null } : null;
        }
      }
      throw e;
    }
  },
  async list(isActive) {
    try {
      if (isActive === null || isActive === undefined) {
        const { rows } = await query(`SELECT ${COLS} FROM api_keys ORDER BY created_at DESC`);
        return rows;
      }
      const { rows } = await query(`SELECT ${COLS} FROM api_keys WHERE is_active = $1 ORDER BY created_at DESC`, [isActive]);
      return rows;
    } catch (e) {
      if (isMissingColError(e)) {
        await ensureCols();
        // retry
        if (isActive === null || isActive === undefined) {
          const { rows } = await query(`SELECT ${COLS} FROM api_keys ORDER BY created_at DESC`);
          return rows;
        }
        const { rows } = await query(`SELECT ${COLS} FROM api_keys WHERE is_active = $1 ORDER BY created_at DESC`, [isActive]);
        return rows;
      }
      throw e;
    }
  },
  async create({ key, email, duration, expiresAt, isActive = true, usageLimit = 100 }) {
    try {
      const { rows } = await query(
        `INSERT INTO api_keys (key, email, duration, expires_at, is_active, usage_limit, usage_count)
         VALUES ($1, $2, $3, $4, $5, $6, 0)
         RETURNING ${COLS}`,
        [key, email, duration, expiresAt ?? null, isActive, usageLimit]
      );
      return rows[0];
    } catch (e) {
      if (isMissingColError(e)) {
        await ensureCols();
        const { rows } = await query(
          `INSERT INTO api_keys (key, email, duration, expires_at, is_active, usage_limit, usage_count)
           VALUES ($1, $2, $3, $4, $5, $6, 0)
           RETURNING ${COLS}`,
          [key, email, duration, expiresAt ?? null, isActive, usageLimit]
        );
        return rows[0];
      }
      throw e;
    }
  },
  async delete(key) {
    const { rowCount } = await query(`DELETE FROM api_keys WHERE key = $1`, [key]);
    return { deletedCount: rowCount };
  },
  async deactivate(key) {
    try {
      await query(`UPDATE api_keys SET is_active = false, updated_at = now() WHERE key = $1`, [key]);
    } catch (e) {
      if (isMissingColError(e)) {
        await ensureCols();
        await query(`UPDATE api_keys SET is_active = false, updated_at = now() WHERE key = $1`, [key]);
      } else throw e;
    }
  },
  async deleteExpired() {
    const { rowCount } = await query(`DELETE FROM api_keys WHERE expires_at < now() AND is_active = false`);
    return { deletedCount: rowCount };
  },
  async resetDailyUsage() {
    try {
      const { rowCount } = await query(`UPDATE api_keys SET usage_count = 0, updated_at = now() WHERE usage_limit IS NOT NULL`);
      return { resetCount: rowCount };
    } catch (e) {
      if (isMissingColError(e)) {
        await ensureCols();
        const { rowCount } = await query(`UPDATE api_keys SET usage_count = 0, updated_at = now() WHERE usage_limit IS NOT NULL`);
        return { resetCount: rowCount };
      }
      throw e;
    }
  },
  getResetAtWIB,
  /**
   * Atomically check throttle + daily limit and increment.
   * Returns { allowed: boolean, status, body, remaining, retryAfter }
   * ponytail: uses SELECT FOR UPDATE in transaction to avoid race
   */
  async consume(key) {
    // ADMIN_API_KEY bypass: tidak ada limit & throttle — ponytail: guard paling atas, O(1)
    if (key && process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY) {
      return { allowed: true, status: 200, row: null, remaining: null, limit: null, used: 0, isAdmin: true };
    }
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let rows;
      try {
        const res = await client.query(`SELECT ${COLS} FROM api_keys WHERE key = $1 AND is_active = true FOR UPDATE`, [key]);
        rows = res.rows;
      } catch (e) {
        if (isMissingColError(e)) {
          await client.query('ROLLBACK');
          console.warn('[ApiKey.consume] missing col, migrating then fallback allow');
          await ensureCols();
          // setelah migrasi, coba lagi sekali; jika masih error, fallback: anggap tanpa limit agar API tidak 500
          try {
            await client.query('BEGIN');
            const res2 = await client.query(`SELECT ${COLS} FROM api_keys WHERE key = $1 AND is_active = true FOR UPDATE`, [key]);
            rows = res2.rows;
          } catch (e2) {
            // fallback legacy read — tanpa limit/throttle
            try { await client.query('ROLLBACK'); } catch {}
            const { rows: legacyRows } = await query(`SELECT ${COLS_LEGACY} FROM api_keys WHERE key = $1 AND is_active = true`, [key]);
            const r = legacyRows[0];
            if (!r) return { allowed: false, status: 401, body: { error: 'Invalid or expired API Key' } };
            // tanpa kolom limit, izinkan (fail-open) agar tidak block produksi
            // tapi tetap cek expiry
            if (r.expiresAt && new Date() > new Date(r.expiresAt)) {
              await query(`UPDATE api_keys SET is_active = false WHERE key = $1`, [key]);
              return { allowed: false, status: 401, body: { error: 'API Key expired' } };
            }
            return { allowed: true, status: 200, row: { ...r, usageLimit: null, usageCount: 0, lastHitAt: null }, remaining: null, limit: null, used: 0 };
          }
        } else throw e;
      }
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return { allowed: false, status: 401, body: { error: 'Invalid or expired API Key' } };
      }
      // expiry check
      if (row.expiresAt && new Date() > new Date(row.expiresAt)) {
        await client.query(`UPDATE api_keys SET is_active = false, updated_at = now() WHERE key = $1`, [key]);
        await client.query('COMMIT');
        return { allowed: false, status: 401, body: { error: 'API Key expired' } };
      }
      const now = new Date();
      // throttle 5s
      if (row.lastHitAt) {
        const delta = now.getTime() - new Date(row.lastHitAt).getTime();
        if (delta < THROTTLE_MS) {
          await client.query('ROLLBACK');
          const retryAfter = Math.ceil((THROTTLE_MS - delta) / 1000);
          return {
            allowed: false,
            status: 429,
            retryAfter,
            body: { error: 'Too many requests', message: `Jeda 5 detik per hit. Coba lagi dalam ${retryAfter} detik.`, retryAfter }
          };
        }
      }
      // daily limit
      if (row.usageLimit !== null && row.usageLimit !== undefined) {
        if (row.usageCount >= row.usageLimit) {
          await client.query('ROLLBACK');
          return {
            allowed: false,
            status: 429,
            body: {
              error: 'Daily limit exceeded',
              message: `Limit harian ${row.usageLimit} tercapai. Reset otomatis jam 00:00 WIB.`,
              limit: row.usageLimit,
              used: row.usageCount,
              remaining: 0,
              resetAt: getResetAtWIB()
            }
          };
        }
      }
      // increment — jika kolom belum ada, akan throw, fallback sudah ditangani di atas, tapi untuk safety wrap
      let updated;
      try {
        const res = await client.query(
          `UPDATE api_keys SET usage_count = usage_count + 1, last_hit_at = now(), updated_at = now() WHERE key = $1 RETURNING ${COLS}`,
          [key]
        );
        updated = res.rows;
      } catch (e) {
        if (isMissingColError(e)) {
          await ensureCols();
          const res = await client.query(
            `UPDATE api_keys SET usage_count = usage_count + 1, last_hit_at = now(), updated_at = now() WHERE key = $1 RETURNING ${COLS}`,
            [key]
          );
          updated = res.rows;
        } else throw e;
      }
      await client.query('COMMIT');
      const fresh = updated[0];
      const remaining = fresh.usageLimit === null ? null : Math.max(0, fresh.usageLimit - fresh.usageCount);
      return { allowed: true, status: 200, row: fresh, remaining, limit: fresh.usageLimit, used: fresh.usageCount };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }
};
