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
      // limit: 100, 1000, 10000, permanent (null = unlimited). Default 100 untuk backward compat
      const tier = limit ?? '100';
      const validLimits = ['100','1000','10000','permanent'];
      if (!validLimits.includes(String(tier))) return res.status(400).json({ error: 'Invalid limit. Use 100, 1000, 10000, permanent' });
      const usageLimit = String(tier) === 'permanent' ? null : parseInt(tier, 10);
      const exists = await ApiKey.findOneByKey(key);
      if (exists) return res.status(409).json({ error: 'Key exists' });
      const expiresAt = calculateExpiry(duration);
      await ApiKey.create({ key, email, duration, expiresAt, isActive: true, usageLimit });
      return res.status(201).json({ success: true, message: 'Created', limit: tier, usageLimit });
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