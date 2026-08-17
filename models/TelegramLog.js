import { query } from '../utils/connectDB.js';

const COLS = `gmail_user AS "gmailUser", gmail_app_password AS "gmailAppPassword", last_notified_at AS "lastNotifiedAt"`;

export const TelegramLog = {
  async getByCreds(gmailUser, gmailAppPassword) {
    const { rows } = await query(
      `SELECT ${COLS} FROM telegram_logs WHERE gmail_user = $1 AND gmail_app_password = $2`,
      [gmailUser, gmailAppPassword]
    );
    return rows[0] || null;
  },
  async upsert(gmailUser, gmailAppPassword, lastNotifiedAt) {
    const { rows } = await query(
      `INSERT INTO telegram_logs (gmail_user, gmail_app_password, last_notified_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (gmail_user, gmail_app_password)
       DO UPDATE SET last_notified_at = EXCLUDED.last_notified_at
       RETURNING ${COLS}`,
      [gmailUser, gmailAppPassword, lastNotifiedAt]
    );
    return rows[0];
  },
  async findSince(date) {
    const { rows } = await query(
      `SELECT ${COLS} FROM telegram_logs WHERE last_notified_at >= $1 ORDER BY last_notified_at DESC`,
      [date]
    );
    return rows;
  }
};
