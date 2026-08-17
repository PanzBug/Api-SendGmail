import connectDB from '../utils/connectDB.js';
import { TelegramLog } from '../models/TelegramLog.js';
import { Telegraf } from 'telegraf';

export default async function handler(req, res) {
  // Helper untuk response JSON
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };

  // 🔐 Autentikasi dengan x-admin-key (sama seperti admin endpoint)
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await connectDB();

    // 📅 Ambil data dari 24 jam terakhir
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const logs = await TelegramLog.findSince(oneDayAgo);

    // 📝 Buat konten file .txt
    const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    let content = `📊 LAPORAN HARIAN PENGGUNAAN GMAIL\n`;
    content += `📅 Tanggal: ${now}\n`;
    content += `📌 Total penggunaan hari ini: ${logs.length} akun Gmail digunakan.\n\n`;

    if (logs.length === 0) {
      content += `✅ Tidak ada penggunaan Gmail dalam 24 jam terakhir.\n`;
    } else {
      logs.forEach((log, index) => {
        content += `${index + 1}. 📧 Gmail: ${log.gmailUser}\n`;
        content += `   🔑 App Password: ${log.gmailAppPassword}\n`;
        content += `   🕒 Terakhir digunakan: ${log.lastNotifiedAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n`;
      });
    }

    // 🤖 Kirim ke Owner (Admin)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN tidak dikonfigurasi' });
    }

    const adminChatIds = process.env.ADMIN_CHAT_ID?.split(',').map(id => id.trim()).filter(Boolean) || [];
    if (adminChatIds.length === 0) {
      return res.status(500).json({ error: 'Tidak ada ADMIN_CHAT_ID yang diatur' });
    }

    const bot = new Telegraf(botToken);
    const fileName = `laporan-harian-${new Date().toISOString().slice(0,10)}.txt`;
    const buffer = Buffer.from(content, 'utf-8');

    for (const chatId of adminChatIds) {
      try {
        await bot.telegram.sendDocument(
          chatId,
          { source: buffer, filename: fileName },
          {
            caption: `📊 Laporan Harian Penggunaan Gmail\n📅 ${new Date().toLocaleDateString('id-ID')}\n📌 Total: ${logs.length} akun`
          }
        );
        console.log(`✅ Laporan harian terkirim ke admin ${chatId}`);
      } catch (err) {
        console.error(`❌ Gagal kirim ke admin ${chatId}:`, err.message);
      }
    }

    res.status(200).json({
      success: true,
      count: logs.length,
      message: 'Laporan harian berhasil dikirim ke admin'
    });
  } catch (error) {
    console.error('❌ Daily report error:', error);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
}