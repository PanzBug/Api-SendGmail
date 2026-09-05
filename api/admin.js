import connectDB from '../utils/connectDB.js';
import { ApiKey } from '../models/ApiKey.js';
import { calculateExpiry } from '../utils/calculateExpiry.js';
import { createLogger, maskKey } from '../utils/logger.js';
const log = createLogger('admin');

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  const t0 = Date.now();
  log.info(`Request start method=${req.method} action=${req.query?.action || '-'} ip=${req.ip || req.headers['x-forwarded-for'] || '-'}`);
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      log.warn(`Unauthorized admin request method=${req.method} action=${req.query?.action || '-'} x-admin-key=${adminKey ? maskKey(adminKey)+' (salah)' : '(empty)'}`);
      return res.status(401).json({ error: 'Unauthorized', hint: 'Header x-admin-key harus sama dengan ADMIN_API_KEY' });
    }
    log.info(`Admin auth ok method=${req.method} action=${req.query?.action || '-'}`);
    await connectDB();

    const { action } = req.query; // list, create, delete

    if (req.method === 'GET' && action === 'list') {
      const { showInactive } = req.query;
      log.info(`List keys showInactive=${showInactive || 'false'}`);
      const keys = await ApiKey.list(showInactive === 'true' ? null : true);
      log.info(`List success count=${keys.length} dur=${Date.now()-t0}ms`);
      return res.status(200).json({ success: true, count: keys.length, keys });
    }

    if (req.method === 'POST' && action === 'create') {
      const { key, email, duration, limit } = req.body;
      log.info(`Create attempt key=${maskKey(key)} email=${email || '-'} duration=${duration || '-'} limit=${limit ?? '100'}`);
      if (!key || !email || !duration) { log.warn('Create fail: Missing fields key/email/duration'); return res.status(400).json({ error: 'Missing fields', hint: 'Wajib: key, email, duration' }); }
      const valid = ['1h','7h','1month','permanent'];
      if (!valid.includes(duration)) { log.warn(`Create fail: Invalid duration=${duration}`); return res.status(400).json({ error: 'Invalid duration', hint: 'Gunakan: 1h, 7h, 1month, permanent' }); }
      // limit: 1..unlimited (angka bebas) atau permanent/unlimited (null = unlimited). Default 100 untuk backward compat
      const tier = limit ?? '100';
      const tierStr = String(tier).toLowerCase();
      let usageLimit;
      if (tierStr === 'permanent' || tierStr === 'unlimited') {
        usageLimit = null;
      } else {
        const parsed = parseInt(tier, 10);
        if (isNaN(parsed) || parsed < 1) { log.warn(`Create fail: Invalid limit=${limit}`); return res.status(400).json({ error: 'Invalid limit. Use 1..unlimited or permanent' }); }
        if (parsed > 2147483647) { log.warn(`Create fail: Limit too large=${parsed}`); return res.status(400).json({ error: 'Limit terlalu besar (max 2147483647)' }); }
        usageLimit = parsed;
      }
      const exists = await ApiKey.findOneByKey(key);
      if (exists) { log.warn(`Create fail: Key exists key=${maskKey(key)}`); return res.status(409).json({ error: 'Key exists' }); }
      const expiresAt = calculateExpiry(duration);
      await ApiKey.create({ key, email, duration, expiresAt, isActive: true, usageLimit });
      const outLimit = usageLimit === null ? 'permanent' : String(usageLimit);
      log.info(`Created key=${maskKey(key)} email=${email} duration=${duration} expiresAt=${expiresAt || 'permanent'} limit=${outLimit} dur=${Date.now()-t0}ms`);
      return res.status(201).json({ success: true, message: 'Created', limit: outLimit, usageLimit });
    }

    if (req.method === 'DELETE' && action === 'delete') {
      const { key } = req.body;
      log.info(`Delete attempt key=${maskKey(key)}`);
      if (!key) { log.warn('Delete fail: Missing key'); return res.status(400).json({ error: 'Missing key' }); }
      const result = await ApiKey.delete(key);
      if (result.deletedCount === 0) { log.warn(`Delete fail: Key not found key=${maskKey(key)}`); return res.status(404).json({ error: 'Key not found' }); }
      log.info(`Deleted key=${maskKey(key)} dur=${Date.now()-t0}ms`);
      return res.status(200).json({ success: true, message: 'Deleted' });
    }

    log.warn(`Invalid action method=${req.method} action=${action || '-'}`);
    return res.status(400).json({ error: 'Invalid action', hint: 'Gunakan ?action=list|create|delete dengan method GET/POST/DELETE yang sesuai' });
  } catch (error) {
    log.error(`Unhandled error: ${error.message}`, { stack: error.stack?.slice(0,1200) });
    res.status(500).json({ error: error.message });
  }
}
