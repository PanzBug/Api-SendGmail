import connectDB from '../utils/connectDB.js';
import { ApiKey } from '../models/ApiKey.js';

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  try {
if (req.method !== 'POST') {
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
    if (!apiKey) return res.status(400).json({ error: 'API Key required' });

    if (apiKey === process.env.ADMIN_API_KEY) {
      return res.status(200).json({ valid: true, role: 'admin' });
    }

    await connectDB();
    const keyData = await ApiKey.findOneActive(apiKey);
    if (!keyData) return res.status(401).json({ valid: false, error: 'Invalid API Key' });
    if (keyData.expiresAt && new Date() > keyData.expiresAt) {
      await ApiKey.deactivate(apiKey);
      return res.status(401).json({ valid: false, error: 'API Key expired' });
    }
    res.status(200).json({ valid: true, role: 'user', email: keyData.email, duration: keyData.duration });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
}