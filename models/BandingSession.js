import { query } from '../utils/connectDB.js';

const COLS = `chat_id AS "chatId", step, account_name AS "accountName", telegram_id AS "telegramId", profile_link AS "profileLink", profile_photo AS "profilePhoto", created_at AS "createdAt"`;

const FIELD_ALIASES = {
  step: 'step',
  accountName: 'account_name',
  telegramId: 'telegram_id',
  profileLink: 'profile_link',
  profilePhoto: 'profile_photo'
};

export const BandingSession = {
  async reset(chatId) {
    const { rows } = await query(
      `INSERT INTO banding_sessions (chat_id, step) VALUES ($1, 0)
       ON CONFLICT (chat_id) DO UPDATE SET step = 0
       RETURNING ${COLS}`,
      [chatId]
    );
    return rows[0];
  },
  async get(chatId) {
    const { rows } = await query(
      `SELECT ${COLS} FROM banding_sessions WHERE chat_id = $1`,
      [chatId]
    );
    return rows[0] || null;
  },
  async update(chatId, fields) {
    const set = [];
    const values = [chatId];
    for (const [key, val] of Object.entries(fields)) {
      if (!(key in FIELD_ALIASES)) continue;
      set.push(`${FIELD_ALIASES[key]} = $${values.length + 1}`);
      values.push(val);
    }
    if (set.length === 0) return null;
    const { rows } = await query(
      `UPDATE banding_sessions SET ${set.join(', ')} WHERE chat_id = $1 RETURNING ${COLS}`,
      values
    );
    return rows[0];
  },
  async delete(chatId) {
    await query(`DELETE FROM banding_sessions WHERE chat_id = $1`, [chatId]);
  }
};
