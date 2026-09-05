import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import { TUJUAN_EMAILS } from '../utils/emailTargets.js';
import connectDB from '../utils/connectDB.js';
import { Gmail } from '../models/Gmail.js';
import { BandingSession } from '../models/BandingSession.js';
import { createLogger, maskEmail } from '../utils/logger.js';
const log = createLogger('polling-bot');

// Load environment variables from parent directory .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_ID || '').split(',').map(id => id.trim());
const BASE_URL = process.env.BASE_URL;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!token) {
  console.error('[polling-bot][ERROR] TELEGRAM_BOT_TOKEN is not defined in .env');
  process.exit(1);
}

if (!BASE_URL) {
  console.error('[polling-bot][ERROR] BASE_URL is not defined in .env (Needed to call API)');
  process.exit(1);
}

// Connect to Database
await connectDB();

const bot = new TelegramBot(token, { polling: true });

function isAdmin(chatId) {
  const ok = ADMIN_CHAT_IDS.includes(String(chatId));
  log.info(`isAdmin check chatId=${chatId} -> ${ok}`);
  return ok;
}

log.info('Bot Telegram (Polling Mode) is running...');

// ========== COMMANDS ==========

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  log.info(`Command /start from ${chatId}`);
  bot.sendMessage(chatId, 'Selamat datang! Gunakan /help untuk melihat daftar perintah.');
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  log.info(`Command /help from ${chatId}`);
  let helpMsg = '📌 **Daftar Perintah:**\n' +
    '/banding - Laporkan akun fake (Emergency)\n' +
    '/batal - Batalkan proses pelaporan\n\n';

  if (isAdmin(chatId)) {
    helpMsg += '👑 **Admin Commands:**\n' +
      '/addgmail <email> <app_password>\n' +
      '/delgmail <email>\n' +
      '/listgmail';
  }
  
  bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
});

// ========== GMAIL MANAGEMENT (ADMIN) ==========

bot.onText(/\/addgmail (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  log.info(`Command /addgmail from ${chatId}`);
  if (!isAdmin(chatId)) { log.warn(`addgmail rejected not admin chatId=${chatId}`); return bot.sendMessage(chatId, '❌ Anda bukan admin.'); }

  const email = match[1];
  const appPassword = match[2];

  try {
    await Gmail.create({ email, appPassword });
    log.info(`addgmail success email=${maskEmail(email)} chatId=${chatId}`);
    bot.sendMessage(chatId, `✅ Gmail \`${email}\` berhasil ditambahkan.`, { parse_mode: 'Markdown' });
  } catch (err) {
    if (err.code === 11000) { log.warn(`addgmail exists email=${maskEmail(email)}`); return bot.sendMessage(chatId, '❌ Gmail sudah terdaftar.'); }
    log.error(`addgmail fail: ${err.message}`);
    bot.sendMessage(chatId, '❌ Gagal menambahkan Gmail: ' + err.message);
  }
});

bot.onText(/\/delgmail (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  log.info(`Command /delgmail from ${chatId}`);
  if (!isAdmin(chatId)) { log.warn(`delgmail rejected not admin`); return bot.sendMessage(chatId, '❌ Anda bukan admin.'); }

  const email = match[1];
  try {
    const result = await Gmail.delete(email);
    if (result.deletedCount > 0) { log.info(`delgmail success email=${maskEmail(email)}`); bot.sendMessage(chatId, `✅ Gmail \`${email}\` dihapus.`, { parse_mode: 'Markdown' }); }
    else { log.warn(`delgmail not found email=${maskEmail(email)}`); bot.sendMessage(chatId, '❌ Gmail tidak ditemukan.'); }
  } catch (err) {
    log.error(`delgmail error: ${err.message}`);
    bot.sendMessage(chatId, '❌ Error saat menghapus Gmail.');
  }
});

bot.onText(/\/listgmail/, async (msg) => {
  const chatId = msg.chat.id;
  log.info(`Command /listgmail from ${chatId}`);
  if (!isAdmin(chatId)) { log.warn(`listgmail rejected not admin`); return bot.sendMessage(chatId, '❌ Anda bukan admin.'); }

  try {
    const gmails = await Gmail.list();
    log.info(`listgmail found ${gmails.length} chatId=${chatId}`);
    if (gmails.length === 0) return bot.sendMessage(chatId, '📭 Daftar Gmail kosong.');
    
    let message = '📋 **Daftar Gmail:**\n\n';
    gmails.forEach((g, index) => {
      message += `${index + 1}. \`${g.email}\`\n`;
    });
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    log.error(`listgmail error: ${err.message}`);
    bot.sendMessage(chatId, '❌ Gagal mengambil daftar Gmail.');
  }
});

// ========== BANDING FEATURE ==========

bot.onText(/\/banding/, async (msg) => {
  const chatId = msg.chat.id;
  log.info(`Command /banding from ${chatId}`);
  await BandingSession.reset(String(chatId));
  log.info(`banding reset chatId=${chatId}`);
  bot.sendMessage(chatId, '🛡️ **Mode Pelaporan Emergency**\n\nSilakan masukkan Username akun yang ingin dilaporkan (Contoh: @telegram):', { parse_mode: 'Markdown' });
});

bot.onText(/\/batal/, async (msg) => {
  const chatId = msg.chat.id;
  log.info(`Command /batal from ${chatId}`);
  await BandingSession.delete(String(chatId));
  log.info(`banding deleted chatId=${chatId}`);
  bot.sendMessage(chatId, '❌ Proses pelaporan dibatalkan.');
});

// ========== MESSAGE HANDLER (FOR STEP-BY-STEP) ==========

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : null;

  // Ignore commands
  if (text && text.startsWith('/')) return;

  const session = await BandingSession.get(String(chatId));
  if (!session) return;

  if (session.step === 0 && text) {
    log.info(`banding step0->1 chatId=${chatId} accountName="${text.slice(0,40)}"`);
    await BandingSession.update(String(chatId), { step: 1, accountName: text });
    return bot.sendMessage(chatId, '✅ Username diterima. Sekarang masukkan ID Telegram akun tersebut (Contoh: 12234567):');
  } else if (session.step === 1 && text) {
    log.info(`banding step1->2 chatId=${chatId} telegramId="${text.slice(0,30)}"`);
    await BandingSession.update(String(chatId), { step: 2, telegramId: text });
    return bot.sendMessage(chatId, '✅ ID diterima. Sekarang masukkan Link Tautan Profile (Contoh: ipanzx):');
  } else if (session.step === 2 && text) {
    log.info(`banding step2->3 chatId=${chatId} profileLink="${text.slice(0,40)}"`);
    await BandingSession.update(String(chatId), { step: 3, profileLink: text });
    return bot.sendMessage(chatId, '✅ Link diterima. Terakhir, kirimkan Foto Profile Telegram yang dimaksud (sebagai Foto, bukan File):');
  }
});

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const session = await BandingSession.get(String(chatId));
  log.info(`photo received chatId=${chatId} step=${session?.step ?? 'no-session'}`);
  
  if (session && session.step === 3) {
    await BandingSession.update(String(chatId), { step: 3, profilePhoto: msg.photo[msg.photo.length - 1].file_id });
    log.info(`banding photo saved chatId=${chatId} account=${session.accountName}`);
    bot.sendMessage(chatId, '⏳ Memulai proses pengiriman laporan ke 50 email tujuan secara bertahap. Mohon tunggu...');
    
    // Process banding in background
    processBanding(chatId, session);
    await BandingSession.delete(String(chatId));
    log.info(`banding session deleted chatId=${chatId}`);
  }
});

async function processBanding(chatId, session) {
  log.info(`processBanding start chatId=${chatId} account=${session.accountName}`);
  const senderGmail = await getRandomGmail();
  if (!senderGmail) {
    log.warn(`processBanding no Gmail available chatId=${chatId}`);
    return bot.sendMessage(chatId, '❌ Gagal: Tidak ada akun Gmail pengirim yang tersedia di database.');
  }
  log.info(`processBanding sender=${maskEmail(senderGmail.email)} chatId=${chatId}`);
  
  await sendBandingEmails(chatId, session, senderGmail);
}

async function getRandomGmail() {
  return await Gmail.getRandom();
}

async function sendBandingEmails(chatId, session, senderGmail) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: senderGmail.email, pass: senderGmail.appPassword }
  });

  const subject = `[EMERGENCY] Fake Telegram Account Actively Hijacking User Accounts in the Name of INDODAX – Immediate Action Please`;
  
  const body = `Dear INDODAX Support Team,

With respect and urgency,

I, Ipanzx, would like to report an emergency situation that requires immediate action. A fake Telegram account is currently actively impersonating INDODAX and is attempting to hijack accounts using a very dangerous method.

Chronology of the Serious Method:
The account contacted me claiming to be the "INDODAX Security Team," informing me that my account was experiencing suspicious activity and would soon be frozen. To "prevent the freeze," they asked me to immediately submit the OTP code under the pretext of an emergency verification process. This is clearly an account takeover attempt that could result in the theft of digital assets.

Fake Account Data Currently in Operation:

· Username: ${session.accountName}
· ID: ${session.telegramId}
· Profile Link: https://t.me/${session.profileLink}
· Method: Posing as Security Team, warning about freezing the fake account, requesting OTP Code for emergency verification

Why This Is Urgent:

1. This account is still online and actively contacting other users.
2. The "threat of freezing the account" method is very effective in creating panic among victims.
3. Every minute of delay has the potential to cause more victims to lose access to their accounts and assets.

I strongly urge INDODAX to immediately:

1. Confirm this report within hours.
2. Officially escalate this to Telegram as soon as possible (ideally within <3 hours).
3. Issue an official warning announcement on the INDODAX channel to alert other users.

I have attached all evidence of conversations and the account profile. I've also reported this through the Report feature, but an official report from the brand owner is crucial for Telegram to immediately block and label the account as a scam.

Please protect us, your users. This isn't just another scam attempt—it's an organized account hijacking attempt under the INDODAX name.

Thank you for your attention and swift action. I'm available to contact you anytime if you need additional information.

Regards,
Ipanzx`;

  let successCount = 0;
  log.info(`banding send start sender=${maskEmail(senderGmail.email)} targets=${TUJUAN_EMAILS.length} account=${session.accountName}`);
  for (let i = 0; i < TUJUAN_EMAILS.length; i++) {
    const target = TUJUAN_EMAILS[i];
    try {
      await transporter.sendMail({
        from: `"${senderGmail.email}" <${senderGmail.email}>`,
        to: target,
        subject: subject,
        text: body
      });
      successCount++;
      log.info(`banding [${i+1}/${TUJUAN_EMAILS.length}] Sent to ${maskEmail(target)}`);
    } catch (err) {
      log.error(`banding failed to ${maskEmail(target)}: ${err.message}`);
    }
    // Cooldown 5 seconds to avoid spam filter
    if (i < TUJUAN_EMAILS.length - 1) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  bot.sendMessage(chatId, `✅ Selesai! Laporan telah dikirim ke ${successCount} dari ${TUJUAN_EMAILS.length} email tujuan.`);
}

// Handle errors
bot.on('polling_error', (error) => {
  log.error(`Polling error code=${error.code} msg=${error.message}`);
});
