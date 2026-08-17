import { query } from '../utils/connectDB.js';

const COLS = `key, email, duration, expires_at AS "expiresAt", is_active AS "isActive", created_at AS "createdAt"`;

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
  async create({ key, email, duration, expiresAt, isActive = true }) {
    const { rows } = await query(
      `INSERT INTO api_keys (key, email, duration, expires_at, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLS}`,
      [key, email, duration, expiresAt ?? null, isActive]
    );
    return rows[0];
  },
  async delete(key) {
    const { rowCount } = await query(`DELETE FROM api_keys WHERE key = $1`, [key]);
    return { deletedCount: rowCount };
  },
  async deactivate(key) {
    await query(`UPDATE api_keys SET is_active = false WHERE key = $1`, [key]);
  },
  async deleteExpired() {
    const { rowCount } = await query(
      `DELETE FROM api_keys WHERE expires_at < now() AND is_active = false`
    );
    return { deletedCount: rowCount };
  }
};
