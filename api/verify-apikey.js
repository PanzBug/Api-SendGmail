import connectDB from '../utils/connectDB.js';
import { ApiKey } from '../models/ApiKey.js';
import { createLogger, maskKey } from '../utils/logger.js';
const log = createLogger('verify-apikey');

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  const t0 = Date.now();
  log.info(`Request start method=${req.method} ip=${req.ip || req.headers['x-forwarded-for'] || '-'}`);
  try {
if (req.method !== 'POST') {
  log.warn(`Method not allowed: ${req.method}`);
  return res.status(405).json({
    status: 'error',
    error: 'Method Not Allowed',
    message: 'Hanya method POST yang diizinkan.',
    usage: {
      endpoint: '/api/verify-apikey',
      method: 'POST',
      description: 'Memverifikasi validitas API Key (user atau admin).',
      required_fields: ['apiKey'],
      example: {
        curl: `curl -X POST ${process.env.BASE_URL}/api/verify-apikey \\
  -H "Content-Type: application/json" \\
  -d '{"apiKey": "YOUR_API_KEY"}'`,
        response: { valid: true, role: 'user', email: 'user@example.com', duration: '1month' }
      }
    },
    author: 'Ipanzxdev'
  });
}
    const { apiKey } = req.body;
    log.info(`Params apiKey=${maskKey(apiKey)}`);
    if (!apiKey) { log.warn('Validation fail: API Key required'); return res.status(400).json({ error: 'API Key required' }); }

    if (apiKey === process.env.ADMIN_API_KEY) {
      log.info(`Verified role=admin apiKey=${maskKey(apiKey)} dur=${Date.now()-t0}ms`);
      return res.status(200).json({ valid: true, role: 'admin' });
    }

    await connectDB();
    const keyData = await ApiKey.findOneActive(apiKey);
    if (!keyData) { log.warn(`Verify fail invalid apiKey=${maskKey(apiKey)}`); return res.status(401).json({ valid: false, error: 'Invalid API Key' }); }
    if (keyData.expiresAt && new Date() > keyData.expiresAt) {
      log.warn(`Verify expired apiKey=${maskKey(apiKey)} expiresAt=${keyData.expiresAt}`);
      await ApiKey.deactivate(apiKey);
      return res.status(401).json({ valid: false, error: 'API Key expired' });
    }
    const limit = keyData.usageLimit === null ? 'permanent' : keyData.usageLimit;
    const used = keyData.usageCount ?? 0;
    const remaining = keyData.usageLimit === null ? null : Math.max(0, keyData.usageLimit - used);
    const resetAt = keyData.usageLimit === null ? null : ApiKey.getResetAtWIB();
    log.info(`Verified role=user email=${keyData.email} duration=${keyData.duration} limit=${limit} used=${used} remaining=${remaining} apiKey=${maskKey(apiKey)} dur=${Date.now()-t0}ms`);
    res.status(200).json({ valid: true, role: 'user', email: keyData.email, duration: keyData.duration, limit, used, remaining, resetAt, expiresAt: keyData.expiresAt });
  } catch (error) {
    log.error(`Unhandled error: ${error.message}`, { stack: error.stack?.slice(0,1200) });
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
}
