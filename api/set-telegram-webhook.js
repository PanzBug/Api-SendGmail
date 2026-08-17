import { Telegraf } from 'telegraf';

export default async function handler(req, res) {
  // Setup helper res.json jika belum ada untuk kompatibilitas Express/Vercel
  if (!res.json) {
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(data, null, 2));
    };
  }

  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const BASE_URL = process.env.BASE_URL;

    // Log untuk debugging di console Pterodactyl (Tenang, token aman di log privat)
    console.log('--- Webhook Setup Attempt ---');
    console.log('BASE_URL:', BASE_URL);
    console.log('BOT_TOKEN exists:', !!BOT_TOKEN);

    if (!BOT_TOKEN || !BASE_URL) {
      return res.status(500).json({ 
        error: 'Konfigurasi .env belum lengkap.', 
        missing: {
          TELEGRAM_BOT_TOKEN: !!BOT_TOKEN,
          BASE_URL: !!BASE_URL
        }
      });
    }

    const bot = new Telegraf(BOT_TOKEN);
    const webhookUrl = `${BASE_URL.replace(/\/$/, '')}/api/telegram-webhook`;
    
    // Set Webhook ke Telegram
    const result = await bot.telegram.setWebhook(webhookUrl);
    
    res.status(200).json({ 
      success: true, 
      message: `Webhook berhasil dipasang!`,
      url: webhookUrl,
      telegram_response: result
    });
  } catch (error) {
    console.error('Set Webhook Error:', error);
    res.status(500).json({ 
      error: 'Gagal memasang webhook.',
      detail: error.message 
    });
  }
}
