import { Telegraf } from 'telegraf';
import { createLogger } from '../utils/logger.js';
const log = createLogger('set-telegram-webhook');

export default async function handler(req, res) {
  // Setup helper res.json jika belum ada untuk kompatibilitas Express/Vercel
  if (!res.json) {
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(data, null, 2));
    };
  }
  const t0 = Date.now();
  log.info(`Request start method=${req.method} ip=${req.ip || req.headers['x-forwarded-for'] || '-'}`);

  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const BASE_URL = process.env.BASE_URL;

    log.info(`Webhook setup attempt BASE_URL=${BASE_URL || '(empty)'} BOT_TOKEN set=${!!BOT_TOKEN} method=${req.method}`);

    if (!BOT_TOKEN || !BASE_URL) {
      log.warn(`Config incomplete BOT_TOKEN=${!!BOT_TOKEN} BASE_URL=${!!BASE_URL}`);
      return res.status(500).json({ 
        error: 'Konfigurasi .env belum lengkap.', 
        hint: 'Set TELEGRAM_BOT_TOKEN dan BASE_URL di env. Lihat README & .env.example',
        missing: {
          TELEGRAM_BOT_TOKEN: !!BOT_TOKEN,
          BASE_URL: !!BASE_URL
        }
      });
    }

    const bot = new Telegraf(BOT_TOKEN);
    const webhookUrl = `${BASE_URL.replace(/\/$/, '')}/api/telegram-webhook`;
    log.info(`Setting webhook url=${webhookUrl}`);
    
    // Set Webhook ke Telegram
    const result = await bot.telegram.setWebhook(webhookUrl);
    log.info(`Webhook set success url=${webhookUrl} telegram_ok=${result} dur=${Date.now()-t0}ms`);
    
    res.status(200).json({ 
      success: true, 
      message: `Webhook berhasil dipasang!`,
      url: webhookUrl,
      telegram_response: result
    });
  } catch (error) {
    log.error(`Set webhook failed: ${error.message}`, { stack: error.stack?.slice(0,1200) });
    res.status(500).json({ 
      error: 'Gagal memasang webhook.',
      detail: error.message,
      hint: 'Pastikan TELEGRAM_BOT_TOKEN valid dan BASE_URL dapat diakses Telegram (https).'
    });
  }
}
