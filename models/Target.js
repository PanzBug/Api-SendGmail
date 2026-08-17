import { query } from '../utils/connectDB.js';

const COLS = `username, added_by AS "addedBy", created_at AS "createdAt"`;

export const Target = {
  async create({ username, addedBy }) {
    try {
      const { rows } = await query(
        `INSERT INTO targets (username, added_by) VALUES ($1, $2) RETURNING ${COLS}`,
        [username, addedBy ?? null]
      );
      return rows[0];
    } catch (err) {
      if (err && err.code === '23505') {
        const dup = new Error('Duplicate key');
        dup.code = 11000;
        throw dup;
      }
      throw err;
    }
  },
  async delete(username) {
    const { rowCount } = await query(`DELETE FROM targets WHERE username = $1`, [username]);
    return { deletedCount: rowCount };
  },
  async list() {
    const { rows } = await query(`SELECT ${COLS} FROM targets ORDER BY created_at ASC`);
    return rows;
  },
  async listUsernames() {
    const { rows } = await query(`SELECT username FROM targets ORDER BY created_at ASC`);
    return rows.map((r) => r.username);
  }
};
