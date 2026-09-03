import { query, getPool } from '../utils/connectDB.js';

const COLS = `key, email, duration, expires_at AS "expiresAt", is_active AS "isActive", created_at AS "createdAt", usage_limit AS "usageLimit", usage_count AS "usageCount", last_hit_at AS "lastHitAt", updated_at AS "updatedAt"`;

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

export const ApiKey = {
  async findOneActive(key) {
    const { rows } = await query(
      `SELECT ${COLS} FROM api_keys WHERE key = $1 AND is_active = true`,
      [key]
    );
    return rows[0] || null;
  },
  async findOneByKey(key) {
    const { rows } = await query(`SELECT ${COLS} FROM api_keys WHERE key = $1`, [key]);
    return rows[0] || null;
  },
  async list(isActive) {
    if (isActive === null || isActive === undefined) {
      const { rows } = await query(`SELECT ${COLS} FROM api_keys ORDER BY created_at DESC`);
      return rows;
    }
    const { rows } = await query(
      `SELECT ${COLS} FROM api_keys WHERE is_active = $1 ORDER BY created_at DESC`,
      [isActive]
    );
    return rows;
  },
  async create({ key, email, duration, expiresAt, isActive = true, usageLimit = 100 }) {
    // usageLimit: null = permanent/unlimited, otherwise int
    const { rows } = await query(
      `INSERT INTO api_keys (key, email, duration, expires_at, is_active, usage_limit, usage_count)
       VALUES ($1, $2, $3, $4, $5, $6, 0)
       RETURNING ${COLS}`,
      [key, email, duration, expiresAt ?? null, isActive, usageLimit]
    );
    return rows[0];
  },
  async delete(key) {
    const { rowCount } = await query(`DELETE FROM api_keys WHERE key = $1`, [key]);
    return { deletedCount: rowCount };
  },
  async deactivate(key) {
    await query(`UPDATE api_keys SET is_active = false, updated_at = now() WHERE key = $1`, [key]);
  },
  async deleteExpired() {
    const { rowCount } = await query(
      `DELETE FROM api_keys WHERE expires_at < now() AND is_active = false`
    );
    return { deletedCount: rowCount };
  },
  async resetDailyUsage() {
    const { rowCount } = await query(
      `UPDATE api_keys SET usage_count = 0, updated_at = now() WHERE usage_limit IS NOT NULL`
    );
    return { resetCount: rowCount };
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
      const { rows } = await client.query(`SELECT ${COLS} FROM api_keys WHERE key = $1 AND is_active = true FOR UPDATE`, [key]);
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
      // increment
      const { rows: updated } = await client.query(
        `UPDATE api_keys SET usage_count = usage_count + 1, last_hit_at = now(), updated_at = now() WHERE key = $1 RETURNING ${COLS}`,
        [key]
      );
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
