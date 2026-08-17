import connectDB from '../utils/connectDB.js';
import { ApiKey } from '../models/ApiKey.js';

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  try {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await connectDB();
    const result = await ApiKey.deleteExpired();
    res.status(200).json({ deleted: result.deletedCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}