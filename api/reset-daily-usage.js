import connectDB from '../utils/connectDB.js';
import { ApiKey } from '../models/ApiKey.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('reset-daily-usage');

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  const t0 = Date.now();
  log.info(`Request start method=${req.method} ip=${req.ip || req.headers['x-forwarded-for'] || '-'} vercelCron=${req.headers['x-vercel-cron'] || '0'}`);
  try {
    const auth = req.headers.authorization || '';
    const querySecret = req.query?.secret;
    const cronSecret = process.env.CRON_SECRET;
    const isBearer = cronSecret && auth === `Bearer ${cronSecret}`;
    const isQuery = cronSecret && querySecret && querySecret === cronSecret;
    const isAdmin = req.headers['x-admin-key'] === process.env.ADMIN_API_KEY;
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const mode = isAdmin ? 'admin-key' : isBearer ? 'bearer' : isQuery ? 'query-secret' : isVercelCron ? 'vercel-cron' : 'none';
    log.info(`Auth check mode=${mode} hasSecret=${!!cronSecret}`);
    // Vercel cron (x-vercel-cron: 1) diizinkan tanpa secret agar vercel.json crons work.
    // External/manual tetap butuh Bearer/secret/admin-key jika CRON_SECRET diset.
    if (cronSecret) {
      if (!isBearer && !isQuery && !isAdmin && !isVercelCron) {
        log.warn(`Unauthorized reset attempt mode=${mode}`);
        return res.status(401).json({ error: 'Unauthorized', hint: 'Use Authorization: Bearer CRON_SECRET or ?secret=CRON_SECRET or x-admin-key (Vercel cron auto-allowed)' });
      }
    }
    await connectDB();
    const result = await ApiKey.resetDailyUsage();
    log.info(`Reset success resetCount=${result.resetCount} dur=${Date.now()-t0}ms nextResetAt=${ApiKey.getResetAtWIB()}`);
    return res.status(200).json({ success: true, resetCount: result.resetCount, resetAt: new Date().toISOString(), nextResetAt: ApiKey.getResetAtWIB(), message: 'Usage count reset untuk semua key dengan limit. Permanent tidak ter-reset.' });
  } catch (error) {
    log.error(`Unhandled error: ${error.message}`, { stack: error.stack?.slice(0,1200) });
    return res.status(500).json({ error: error.message });
  }
}
