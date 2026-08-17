import { query } from '../utils/connectDB.js';

const COLS = `email, app_password AS "appPassword", created_at AS "createdAt"`;

export const Gmail = {
  async create({ email, appPassword }) {
    try {
      const { rows } = await query(
        `INSERT INTO gmails (email, app_password) VALUES ($1, $2) RETURNING ${COLS}`,
        [email, appPassword]
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
  async delete(email) {
    const { rowCount } = await query(`DELETE FROM gmails WHERE email = $1`, [email]);
    return { deletedCount: rowCount };
  },
  async list() {
    const { rows } = await query(`SELECT ${COLS} FROM gmails ORDER BY created_at ASC`);
    return rows;
  },
  async count() {
    const { rows } = await query(`SELECT COUNT(*)::int AS count FROM gmails`);
    return rows[0].count;
  },
  async getRandom() {
    const { rows } = await query(`SELECT ${COLS} FROM gmails ORDER BY random() LIMIT 1`);
    return rows[0] || null;
  }
};
