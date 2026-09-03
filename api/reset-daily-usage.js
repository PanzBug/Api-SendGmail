import connectDB from '../utils/connectDB.js';
import { ApiKey } from '../models/ApiKey.js';

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  try {
    const auth = req.headers.authorization || '';
    const querySecret = req.query?.secret;
    const cronSecret = process.env.CRON_SECRET;
    const isBearer = cronSecret && auth === `Bearer ${cronSecret}`;
    const isQuery = cronSecret && querySecret && querySecret === cronSecret;
    const isAdmin = req.headers['x-admin-key'] === process.env.ADMIN_API_KEY;
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    // Vercel cron (x-vercel-cron: 1) diizinkan tanpa secret agar vercel.json crons work.
    // External/manual tetap butuh Bearer/secret/admin-key jika CRON_SECRET diset.
    if (cronSecret) {
      if (!isBearer && !isQuery && !isAdmin && !isVercelCron) {
        return res.status(401).json({ error: 'Unauthorized', hint: 'Use Authorization: Bearer CRON_SECRET or ?secret=CRON_SECRET or x-admin-key (Vercel cron auto-allowed)' });
      }
    }
    await connectDB();
    const result = await ApiKey.resetDailyUsage();
    // Optional: notify via console
    console.log(`[reset-daily-usage] Reset ${result.resetCount} keys at ${new Date().toISOString()} WIB 00:00`);
    return res.status(200).json({ success: true, resetCount: result.resetCount, resetAt: new Date().toISOString(), nextResetAt: ApiKey.getResetAtWIB(), message: 'Usage count reset untuk semua key dengan limit. Permanent tidak ter-reset.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
