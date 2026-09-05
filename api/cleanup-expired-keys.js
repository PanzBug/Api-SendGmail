import connectDB from '../utils/connectDB.js';
import { ApiKey } from '../models/ApiKey.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('cleanup-expired-keys');

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  const t0 = Date.now();
  log.info(`Request start method=${req.method} ip=${req.ip || req.headers['x-forwarded-for'] || '-'}`);
  try {
    const auth = req.headers.authorization || '';
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (auth !== expected) {
      log.warn(`Unauthorized cleanup attempt auth=${auth ? auth.slice(0,12)+'***' : '(empty)'} expected=Bearer ***`);
      return res.status(401).json({ error: 'Unauthorized', hint: 'Gunakan Authorization: Bearer CRON_SECRET' });
    }
    log.info('Auth ok, deleting expired keys...');
    await connectDB();
    const result = await ApiKey.deleteExpired();
    log.info(`Cleanup success deleted=${result.deletedCount} dur=${Date.now()-t0}ms`);
    res.status(200).json({ success: true, deleted: result.deletedCount, deletedCount: result.deletedCount });
  } catch (error) {
    log.error(`Unhandled error: ${error.message}`, { stack: error.stack?.slice(0,1200) });
    res.status(500).json({ error: error.message });
  }
}
