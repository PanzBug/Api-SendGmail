import connectDB from '../utils/connectDB.js';
import { ApiKey } from '../models/ApiKey.js';
import { calculateExpiry } from '../utils/calculateExpiry.js';

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await connectDB();

    const { action } = req.query; // list, create, delete

    if (req.method === 'GET' && action === 'list') {
      const { showInactive } = req.query;
      const keys = await ApiKey.list(showInactive === 'true' ? null : true);
      return res.status(200).json({ success: true, count: keys.length, keys });
    }

    if (req.method === 'POST' && action === 'create') {
      const { key, email, duration, limit } = req.body;
      if (!key || !email || !duration) return res.status(400).json({ error: 'Missing fields' });
      const valid = ['1h','7h','1month','permanent'];
      if (!valid.includes(duration)) return res.status(400).json({ error: 'Invalid duration' });
      // limit: 1..unlimited (angka bebas) atau permanent/unlimited (null = unlimited). Default 100 untuk backward compat
      const tier = limit ?? '100';
      const tierStr = String(tier).toLowerCase();
      let usageLimit;
      if (tierStr === 'permanent' || tierStr === 'unlimited') {
        usageLimit = null;
      } else {
        const parsed = parseInt(tier, 10);
        if (isNaN(parsed) || parsed < 1) return res.status(400).json({ error: 'Invalid limit. Use 1..unlimited or permanent' });
        if (parsed > 2147483647) return res.status(400).json({ error: 'Limit terlalu besar (max 2147483647)' });
        usageLimit = parsed;
      }
      const exists = await ApiKey.findOneByKey(key);
      if (exists) return res.status(409).json({ error: 'Key exists' });
      const expiresAt = calculateExpiry(duration);
      await ApiKey.create({ key, email, duration, expiresAt, isActive: true, usageLimit });
      const outLimit = usageLimit === null ? 'permanent' : String(usageLimit);
      return res.status(201).json({ success: true, message: 'Created', limit: outLimit, usageLimit });
    }

    if (req.method === 'DELETE' && action === 'delete') {
      const { key } = req.body;
      if (!key) return res.status(400).json({ error: 'Missing key' });
      const result = await ApiKey.delete(key);
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Key not found' });
      return res.status(200).json({ success: true, message: 'Deleted' });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}