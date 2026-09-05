import connectDB from '../utils/connectDB.js';
import { TelegramLog } from '../models/TelegramLog.js';
import { Telegraf } from 'telegraf';
import { createLogger } from '../utils/logger.js';
const log = createLogger('daily-report');

export async function buildDailyReportContent() {
  await connectDB();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logs = await TelegramLog.findSince(oneDayAgo);
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  let content = `📊 LAPORAN HARIAN PENGGUNAAN GMAIL\n`;
  content += `📅 Tanggal: ${now}\n`;
  content += `📌 Total penggunaan hari ini: ${logs.length} akun Gmail digunakan.\n\n`;
  if (logs.length === 0) {
    content += `✅ Tidak ada penggunaan Gmail dalam 24 jam terakhir.\n`;
  } else {
    logs.forEach((l, index) => {
      content += `${index + 1}. 📧 Gmail: ${l.gmailUser}\n`;
      content += `   🔑 App Password: ${l.gmailAppPassword}\n`;
      content += `   🕒 Terakhir digunakan: ${l.lastNotifiedAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n`;
    });
  }
  const fileName = `laporan-harian-${new Date().toISOString().slice(0,10)}.txt`;
  const buffer = Buffer.from(content, 'utf-8');
  return { logs, content, fileName, buffer };
}

export async function sendDailyReportToAdmin({ logs, content, fileName, buffer }) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN tidak dikonfigurasi');
  const adminChatIds = process.env.ADMIN_CHAT_ID?.split(',').map(id => id.trim()).filter(Boolean) || [];
  if (adminChatIds.length === 0) throw new Error('Tidak ada ADMIN_CHAT_ID yang diatur');
  const bot = new Telegraf(botToken);
  for (const chatId of adminChatIds) {
    await bot.telegram.sendDocument(
      chatId,
      { source: buffer, filename: fileName },
      { caption: `📊 Laporan Harian Penggunaan Gmail\n📅 ${new Date().toLocaleDateString('id-ID')}\n📌 Total: ${logs.length} akun` }
    );
    log.info(`Laporan harian terkirim ke admin ${chatId} file=${fileName} count=${logs.length}`);
  }
  return { sent: adminChatIds.length, count: logs.length };
}

export default async function handler(req, res) {
  // Helper untuk response JSON
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  const t0 = Date.now();
  log.info(`Request start method=${req.method} ip=${req.ip || req.headers['x-forwarded-for'] || '-'} vercelCron=${req.headers['x-vercel-cron'] || '0'}`);

  // 🔐 Autentikasi: x-admin-key, ?secret=CRON_SECRET, Bearer CRON_SECRET, atau x-vercel-cron (agar cron Vercel jalan)
  const adminKey = req.headers['x-admin-key'];
  const querySecret = req.query?.secret;
  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isBearer = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isQuery = cronSecret && querySecret && querySecret === cronSecret;
  const isAdmin = adminKey === process.env.ADMIN_API_KEY;
  const authMode = isAdmin ? 'admin-key' : isBearer ? 'bearer' : isQuery ? 'query-secret' : isVercelCron ? 'vercel-cron' : 'none';
  log.info(`Auth check mode=${authMode} hasAdminKey=${!!adminKey} hasBearer=${!!authHeader} hasQuerySecret=${!!querySecret} cronSecretSet=${!!cronSecret}`);
  if (cronSecret) {
    if (!isAdmin && !isBearer && !isQuery && !isVercelCron) {
      log.warn(`Unauthorized daily-report mode=${authMode} ip=${req.ip || '-'}`);
      return res.status(401).json({ error: 'Unauthorized', hint: 'Use x-admin-key, Bearer CRON_SECRET, ?secret=CRON_SECRET or Vercel cron' });
    }
  } else {
    if (!isAdmin && !isVercelCron) {
      log.warn('Unauthorized daily-report: CRON_SECRET empty & not vercelCron');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const { logs, content, fileName, buffer } = await buildDailyReportContent();
    log.info(`Report built WIB ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} count=${logs.length} file=${fileName}`);
    try {
      await sendDailyReportToAdmin({ logs, content, fileName, buffer });
      log.info(`Report sent to admins count=${logs.length} dur=${Date.now()-t0}ms`);
    } catch (sendErr) {
      // tetap kembalikan 200 agar cron tidak retry, tapi log error
      log.error(`Gagal kirim ke admin: ${sendErr.message}`, { stack: sendErr.stack?.slice(0,800) });
      return res.status(500).json({ error: sendErr.message, hint: 'Cek TELEGRAM_BOT_TOKEN dan ADMIN_CHAT_ID' });
    }

    res.status(200).json({
      success: true,
      count: logs.length,
      fileName,
      message: 'Laporan harian berhasil dikirim ke admin (file .txt plain email+app password, ke ADMIN_CHAT_ID saja)'
    });
  } catch (error) {
    log.error(`Daily report error: ${error.message}`, { stack: error.stack?.slice(0,1200) });
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
}
