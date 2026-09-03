import { Telegraf } from 'telegraf';
import { Gmail } from '../models/Gmail.js';
import { BandingSession } from '../models/BandingSession.js';
import connectDB from '../utils/connectDB.js';
import { TUJUAN_EMAILS } from '../utils/emailTargets.js';
import { normalizeTargetUrl } from '../utils/targetInjector.js';
import { Target } from '../models/Target.js';
import nodemailer from 'nodemailer';

const BASE_URL = process.env.BASE_URL;
const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_ID || '').split(',').map(id => id.trim());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isAdmin(chatId) {
  return ADMIN_CHAT_IDS.includes(String(chatId));
}

// Cooldown untuk command dailyreport (60 detik)
const dailyReportCooldown = new Map();

export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      status: 'error',
      error: 'Method Not Allowed',
      message: 'Webhook Telegram hanya menerima POST request.',
      usage: 'Endpoint ini digunakan oleh Telegram untuk mengirim update. Jangan dipanggil manual. Untuk menguji bot, gunakan perintah di aplikasi Telegram.',
      author: 'Ipanzxdev'
    });
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    console.error('FATAL: TELEGRAM_BOT_TOKEN missing');
    return res.status(500).json({ error: 'Missing bot token' });
  }

  try {
    const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9_000 });

    // Fungsi kirim pesan dengan retry jika rate limit
    const sendMessageWithRetry = async (chatId, text, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          await bot.telegram.sendMessage(chatId, text);
          return;
        } catch (err) {
          if (err.response && err.response.statusCode === 429) {
            const retryAfter = err.response.body?.parameters?.retry_after || 5;
            console.log(`[sendMessage] Rate limit, menunggu ${retryAfter} detik... (attempt ${i+1}/${retries})`);
            await sleep(retryAfter * 1000);
          } else {
            throw err;
          }
        }
      }
      throw new Error('Gagal mengirim pesan setelah beberapa percobaan.');
    };

    bot.start((ctx) => ctx.reply('Selamat datang! Gunakan /help untuk melihat daftar perintah.'));
    bot.help((ctx) => ctx.reply(
      '/banding - Laporkan akun fake (Emergency)\n' +
      '/batal - Batalkan pelaporan\n\n' +
      'Admin commands:\n' +
      '/addkey <key> <email> <duration> <limit>\n' +
      '  duration: 1h, 7h, 1month, permanent\n' +
      '  limit: 100, 1000, 10000, permanent (default 100)\n' +
      '  contoh: /addkey abc123 user@mail.com 1month 1000\n' +
      '/delkey <key>\n' +
      '/listkey\n' +
      '/addgmail <email> <app_password>\n' +
      '/delgmail <email>\n' +
      '/listgmail\n' +
      '/addtarget <https://t.me/username>\n' +
      '/deltarget <username>\n' +
      '/listtarget\n' +
      '/dailyreport - Kirim laporan harian penggunaan Gmail (alias /rekap)'
    ));

    // ========== ADMIN COMMANDS ==========
    bot.command('addkey', async (ctx) => {
      if (!isAdmin(ctx.chat.id)) return ctx.reply('❌ Anda bukan admin.');
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 3) return ctx.reply('Format: /addkey <key> <email> <duration> [limit]\nDurasi: 1h,7h,1month,permanent\nLimit: 100,1000,10000,permanent (default 100)\nContoh: /addkey abc123 user@mail.com 1month 1000');
      const [key, email, duration, limitRaw] = args;
      const limit = limitRaw ?? '100';
      const validLimits = ['100','1000','10000','permanent'];
      if (!validLimits.includes(limit)) return ctx.reply('❌ Limit tidak valid. Gunakan: 100, 1000, 10000, permanent');
      const validDurations = ['1h','7h','1month','permanent'];
      if (!validDurations.includes(duration)) return ctx.reply('❌ Durasi tidak valid. Gunakan: 1h, 7h, 1month, permanent');
      try {
        const response = await fetch(`${BASE_URL}/api/admin?action=create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.ADMIN_API_KEY },
          body: JSON.stringify({ key, email, duration, limit })
        });
        const data = await response.json();
        if (response.ok) ctx.reply(`✅ API Key ${key} berhasil ditambahkan.\n📊 Limit: ${limit}/hari (reset 00:00 WIB)\n⏱️ Throttle: 5 detik/hit`);
        else ctx.reply(`❌ Gagal: ${data.error}`);
      } catch (err) {
        ctx.reply('❌ Error menghubungi server.');
      }
    });

    bot.command('delkey', async (ctx) => {
      if (!isAdmin(ctx.chat.id)) return ctx.reply('❌ Anda bukan admin.');
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) return ctx.reply('Format: /delkey <key>');
      const key = args[0];
      try {
        const response = await fetch(`${BASE_URL}/api/admin?action=delete`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.ADMIN_API_KEY },
          body: JSON.stringify({ key })
        });
        const data = await response.json();
        if (response.ok) ctx.reply(`✅ API Key ${key} dihapus.`);
        else ctx.reply(`❌ Gagal: ${data.error}`);
      } catch (err) {
        ctx.reply('❌ Error menghubungi server.');
      }
    });

    bot.command('listkey', async (ctx) => {
      if (!isAdmin(ctx.chat.id)) return ctx.reply('❌ Anda bukan admin.');
      try {
        const response = await fetch(`${BASE_URL}/api/admin?action=list`, {
          headers: { 'x-admin-key': process.env.ADMIN_API_KEY }
        });
        const data = await response.json();
        if (!data.success) return ctx.reply('Gagal mengambil data.');
        if (data.keys.length === 0) return ctx.reply('Tidak ada API Key.');
        let msg = '*Daftar API Key:*\n';
        for (const k of data.keys.slice(0, 20)) {
          const lim = k.usageLimit === null || k.usageLimit === undefined ? '∞' : k.usageLimit;
          const used = k.usageCount ?? 0;
          const rem = k.usageLimit === null ? '∞' : Math.max(0, k.usageLimit - used);
          msg += `\`${k.key}\` - ${k.duration} - lim:${lim} used:${used} sisa:${rem} - ${k.isActive ? '✅ aktif' : '❌ nonaktif'}\n`;
        }
        if (data.keys.length > 20) msg += `\n... dan ${data.keys.length - 20} lainnya.`;
        msg += '\n_Reset harian 00:00 WIB | Throttle 5s/hit_';
        ctx.reply(msg, { parse_mode: 'Markdown' });
      } catch (err) {
        ctx.reply('❌ Error menghubungi server.');
      }
    });

    // ========== GMAIL MANAGEMENT ==========
    bot.command('addgmail', async (ctx) => {
      if (!isAdmin(ctx.chat.id)) return ctx.reply('❌ Anda bukan admin.');
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 2) return ctx.reply('Format: /addgmail <gmail> <app_password>');
      
      const [email, appPassword] = args;
      try {
        await connectDB();
        await Gmail.create({ email, appPassword });
        ctx.reply(`✅ Gmail ${email} berhasil ditambahkan.`);
      } catch (err) {
        if (err.code === 11000) return ctx.reply('❌ Gmail sudah terdaftar.');
        ctx.reply('❌ Gagal menambahkan Gmail.');
      }
    });

    bot.command('delgmail', async (ctx) => {
      if (!isAdmin(ctx.chat.id)) return ctx.reply('❌ Anda bukan admin.');
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) return ctx.reply('Format: /delgmail <gmail>');
      
      const email = args[0];
      try {
        await connectDB();
        const result = await Gmail.delete(email);
        if (result.deletedCount > 0) ctx.reply(`✅ Gmail ${email} dihapus.`);
        else ctx.reply('❌ Gmail tidak ditemukan.');
      } catch (err) {
        ctx.reply('❌ Error saat menghapus Gmail.');
      }
    });

    bot.command('listgmail', async (ctx) => {
      if (!isAdmin(ctx.chat.id)) return ctx.reply('❌ Anda bukan admin.');
      try {
        await connectDB();
        const gmails = await Gmail.list();
        if (gmails.length === 0) return ctx.reply('📭 Daftar Gmail kosong.');
        
        let message = '📋 **Daftar Gmail:**\n\n';
        gmails.forEach((g, index) => {
          message += `${index + 1}. ${g.email}\n`;
        });
        ctx.reply(message, { parse_mode: 'Markdown' });
      } catch (err) {
        ctx.reply('❌ Gagal mengambil daftar Gmail.');
      }
    });

    // ========== TARGET MANAGEMENT ==========
    bot.command('addtarget', async (ctx) => {
      if (!isAdmin(ctx.chat.id)) return ctx.reply('❌ Anda bukan admin.');
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) return ctx.reply('Format: /addtarget <https://t.me/username>');

      const url = normalizeTargetUrl(args[0]);
      if (!url) {
        return ctx.reply('❌ Format tidak valid. Gunakan: https://t.me/username (3-32 karakter, huruf/angka/_ ).');
      }
      try {
        await connectDB();
        await Target.create({ username: url, addedBy: String(ctx.chat.id) });
        ctx.reply(`✅ Target ${url} berhasil ditambahkan.`);
      } catch (err) {
        if (err.code === 11000) return ctx.reply('❌ Target tersebut sudah terdaftar.');
        ctx.reply('❌ Gagal menambahkan target.');
      }
    });

    bot.command('deltarget', async (ctx) => {
      if (!isAdmin(ctx.chat.id)) return ctx.reply('❌ Anda bukan admin.');
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) return ctx.reply('Format: /deltarget <username> (bisa https://t.me/x, @x, atau x)');

      let url = normalizeTargetUrl(args[0]);
      if (!url) {
        const names = args[0].split('/').filter(Boolean).pop();
        url = names ? `https://t.me/${names.replace(/^@/, '')}` : null;
      }
      if (!url) return ctx.reply('❌ Format username tidak valid.');

      try {
        await connectDB();
        const result = await Target.delete(url);
        if (result.deletedCount > 0) ctx.reply(`✅ Target ${url} dihapus.`);
        else ctx.reply('❌ Target tidak ditemukan.');
      } catch (err) {
        ctx.reply('❌ Error saat menghapus target.');
      }
    });

    bot.command('listtarget', async (ctx) => {
      if (!isAdmin(ctx.chat.id)) return ctx.reply('❌ Anda bukan admin.');
      try {
        await connectDB();
        const targets = await Target.list();
        if (targets.length === 0) return ctx.reply('📭 Daftar target kosong.');

        let message = '🎯 **Daftar Target:**\n\n';
        targets.forEach((t, index) => {
          message += `${index + 1}. ${t.username}\n`;
        });
        ctx.reply(message, { parse_mode: 'Markdown' });
      } catch (err) {
        ctx.reply('❌ Gagal mengambil daftar target.');
      }
    });

    // ========== DAILY REPORT (MANUAL) ==========
    bot.command(['dailyreport', 'rekap'], async (ctx) => {
      const chatId = ctx.chat.id;

      // Cek admin
      if (!isAdmin(chatId)) {
        await sendMessageWithRetry(chatId, '❌ Anda bukan admin.');
        return;
      }

      // Cek cooldown (60 detik)
      const lastCall = dailyReportCooldown.get(chatId) || 0;
      const now = Date.now();
      if (now - lastCall < 60000) {
        const remaining = Math.ceil((60000 - (now - lastCall)) / 1000);
        await sendMessageWithRetry(chatId, `⏳ Mohon tunggu ${remaining} detik sebelum memanggil laporan lagi.`);
        return;
      }
      dailyReportCooldown.set(chatId, now);

      try {
        // Panggil API laporan harian
        const response = await fetch(`${BASE_URL}/api/daily-report`, {
          method: 'GET',
          headers: { 'x-admin-key': process.env.ADMIN_API_KEY }
        });
        const data = await response.json();

        if (data.success) {
          await sendMessageWithRetry(chatId, `✅ Laporan harian berhasil dikirim ke admin (${data.count} akun digunakan hari ini).`);
        } else {
          await sendMessageWithRetry(chatId, `❌ Gagal: ${data.error || 'Terjadi kesalahan.'}`);
        }
      } catch (err) {
        console.error('Error dailyreport:', err);
        await sendMessageWithRetry(chatId, '❌ Gagal menghubungi server untuk laporan harian.');
      }
    });

    // ========== BANDING ==========
    bot.command('banding', async (ctx) => {
      await connectDB();
      await BandingSession.reset(ctx.chat.id);
      ctx.reply('🛡️ **Mode Pelaporan Emergency**\n\nSilakan masukkan Username akun yang ingin dilaporkan (Contoh: @telegram):');
    });

    // ========== TEXT HANDLER ==========
    bot.on('text', async (ctx) => {
      const chatId = ctx.chat.id;
      const text = ctx.message.text.trim();
      await connectDB();

      if (text === '/batal') {
        await BandingSession.delete(chatId);
        await ctx.reply('❌ Dibatalkan.');
        return;
      }
      
      const session = await BandingSession.get(chatId);
      if (session) {
        if (session.step === 0) {
          await BandingSession.update(chatId, { step: 1, accountName: text });
          return ctx.reply('✅ Username diterima. Sekarang masukkan ID Telegram akun tersebut (Contoh: 12234567):');
        } else if (session.step === 1) {
          await BandingSession.update(chatId, { step: 2, telegramId: text });
          return ctx.reply('✅ ID diterima. Sekarang masukkan Link Tautan Profile (Contoh: ipanzx):');
        } else if (session.step === 2) {
          await BandingSession.update(chatId, { step: 3, profileLink: text });
          return ctx.reply('✅ Link diterima. Terakhir, kirimkan Foto Profile Telegram yang dimaksud:');
        }
      }
    });

    // ========== PHOTO HANDLER (BANDING) ==========
    bot.on('photo', async (ctx) => {
      const chatId = ctx.chat.id;
      await connectDB();
      const session = await BandingSession.get(chatId);
      
      if (session && session.step === 3) {
        await BandingSession.update(chatId, { step: 3, profilePhoto: ctx.message.photo[ctx.message.photo.length - 1].file_id });
        
        ctx.reply('⏳ Memulai proses pengiriman laporan ke 50 email tujuan secara bertahap. Mohon tunggu...');
        processBanding(ctx, session);
        await BandingSession.delete(chatId);
      }
    });

    // ========== BANDING EMAIL PROCESS ==========
    async function processBanding(ctx, session) {
      const senderGmail = await getRandomGmail();
      if (!senderGmail) {
        return ctx.reply('❌ Gagal: Tidak ada akun Gmail pengirim yang tersedia di database.');
      }
      await sendBandingEmails(ctx, session, senderGmail);
    }

    async function getRandomGmail() {
      return await Gmail.getRandom();
    }

    async function sendBandingEmails(ctx, session, senderGmail) {
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
          console.log(`[${i+1}/${TUJUAN_EMAILS.length}] Sent to ${target}`);
        } catch (err) {
          console.error(`Failed to send to ${target}:`, err);
        }
        if (i < TUJUAN_EMAILS.length - 1) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      
      await ctx.reply(`✅ Selesai! Laporan telah dikirim ke ${successCount} dari ${TUJUAN_EMAILS.length} email tujuan.`);
    }

    await bot.handleUpdate(req.body);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Unhandled webhook error:', error);
    return res.status(500).send('Internal Server Error');
  }
}