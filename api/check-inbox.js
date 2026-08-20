import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import cors from 'cors';
import { ApiKey } from '../models/ApiKey.js';
import connectDB from '../utils/connectDB.js';

const DEADLINE_MS = 25 * 1000; // respond before Vercel (60s) and before bot's 30s client timeout
const READ_MAX_BYTES = 200 * 1024; // bound full-body download on uid read
const SNIPPET_MAX_BYTES = 2048;
const IMAP_TIMEOUTS = {
  connectionTimeout: 12 * 1000,
  authTimeout: 8 * 1000,
  greetingTimeout: 8 * 1000,
};

export const config = { maxDuration: 60 };

const runMiddleware = (req, res, fn) =>
  new Promise((resolve, reject) => {
    fn(req, res, result => (result instanceof Error ? reject(result) : resolve(result)));
  });

function findTextPart(node) {
  if (node?.type?.startsWith('text/plain')) return node.part;
  if (node?.childNodes) {
    for (const child of node.childNodes) {
      const textPart = findTextPart(child);
      if (textPart) return textPart;
    }
  }
  return null;
}

export function withDeadline(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('IMAP operation timed out'), { code: 'INBOX_DEADLINE' }));
    }, ms);
    promise.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export async function runInbox(client, { uid, limit, from, search }) {
  if (uid) {
    // Fetch only the first part of the source (bounded) instead of the whole message
    let msg = await client.fetchOne(uid.toString(), { source: { maxLength: READ_MAX_BYTES } }, { uid: true });
    if (!msg) {
      return { status: 404, json: { error: 'Email not found' } };
    }

    const parsed = await simpleParser(msg.source);

    return {
      status: 200,
      json: {
        success: true,
        email: {
          uid: msg.uid,
          subject: parsed.subject,
          from: parsed.from?.text || '',
          to: parsed.to?.text || '',
          date: parsed.date,
          text: parsed.text,
          html: parsed.html,
          snippet: parsed.textAsHtml ? parsed.textAsHtml.substring(0, 200) : '',
        },
      },
    };
  }

  // List or Search messages (metadata + snippet)
  let emails = [];
  let query = {};
  const fetchOptions = {
    envelope: true,
    bodyStructure: true,
    uid: true, // Always fetch by UID
  };

  if (from) query.from = from;
  if (search) query.or = [{ subject: search }, { body: search }];

  const totalMessages = client.mailbox.exists;

  if (totalMessages === 0) {
    return {
      status: 200,
      json: { success: true, count: 0, emails: [], message: 'Kotak masuk kosong.' },
    };
  }

  let sequence;
  let fetchRangeOptions = {};
  if (from || search) {
    // Use client.search to get UIDs, then pass to fetch with uid: true
    const searchUids = await client.search(query);
    if (searchUids.length === 0) {
      return {
        status: 200,
        json: {
          success: true,
          count: 0,
          emails: [],
          message: 'Tidak ada email yang cocok.',
        },
      };
    }
    // Sort UIDs descending and slice for limit, then reverse to get oldest first for fetch range
    let limitedUids = searchUids.sort((a, b) => b - a).slice(0, limit);
    sequence = limitedUids.sort((a, b) => a - b); // Get oldest first
    fetchRangeOptions = { uid: true }; // Ensure fetch uses UIDs
  } else {
    // List latest 'limit' messages by sequence number (default behavior)
    const start = Math.max(1, totalMessages - limit + 1);
    sequence = `${start}:*`;
    fetchRangeOptions = { uid: false }; // Ensure fetch uses sequence numbers
  }

  for await (let msg of client.fetch(sequence, fetchOptions, fetchRangeOptions)) {
    let emailData = {
      uid: msg.uid,
      seq: msg.seq,
      subject: msg.envelope.subject || '(Tanpa Subjek)',
      from: msg.envelope.from?.[0]?.address || 'Unknown',
      to: msg.envelope.to?.[0]?.address || 'Unknown',
      date: msg.envelope.date,
      messageId: msg.envelope.messageId,
      snippet: '', // Initialize snippet
    };

    // Extract snippet from the first text part of the email
    const textPartPath = msg.bodyStructure ? findTextPart(msg.bodyStructure) : null;

    if (textPartPath) {
      try {
        // Download only a small portion of the text part for the snippet
        const snippetStream = await client.download(msg.uid.toString(), textPartPath, {
          uid: true,
          maxBytes: SNIPPET_MAX_BYTES,
        });
        let snippetBuffer = Buffer.alloc(0);
        for await (const chunk of snippetStream.content) {
          snippetBuffer = Buffer.concat([snippetBuffer, chunk]);
        }
        emailData.snippet = snippetBuffer.toString('utf-8').substring(0, 500).replace(/\s+/g, ' ').trim() + '...';
      } catch (downloadError) {
        console.warn(`Failed to download snippet for UID ${msg.uid}, part ${textPartPath}:`, downloadError.message);
        emailData.snippet = '(Gagal mengambil cuplikan)';
      }
    }

    emails.push(emailData);
  }

  return {
    status: 200,
    json: {
      success: true,
      count: emails.length,
      total_inbox: totalMessages,
      emails: emails.sort((a, b) => b.seq - a.seq),
    },
  };
}

export async function accessInbox(client, params) {
  let lock;
  try {
    await client.connect();
    lock = await client.getMailboxLock('INBOX');
    return await runInbox(client, params);
  } finally {
    // Cleanup failures must never turn a successful request into a 500
    try {
      if (lock) lock.release();
    } catch {}
    try {
      await client.logout();
    } catch {}
  }
}

export function mapError(error) {
  let statusCode = 500;
  let errorMessage = 'Failed to access Gmail inbox';
  let hint = 'Pastikan IMAP diaktifkan di pengaturan Gmail dan gunakan App Password (bukan password utama).';

  // Check for common authentication errors
  if (
    error.message.includes('Invalid credentials') ||
    error.message.includes('authenticationError') ||
    error.message.includes('LOGIN failed') ||
    error.message.includes('AUTHENTICATIONFAILED') ||
    error.message.includes('Application-specific password required') ||
    error.message.includes('IMAP is disabled')
  ) {
    statusCode = 401;
    errorMessage = 'IMAP Authentication Failed';
    hint = 'Pastikan: 1. IMAP diaktifkan di pengaturan Gmail (Settings -> See all settings -> Forwarding and POP/IMAP -> Enable IMAP). 2. Anda telah mengaktifkan 2-Step Verification di akun Google Anda. 3. Anda menggunakan App Password 16 karakter yang benar (bukan password utama Gmail Anda).';
  } else if (error.message.includes('timed out')) {
    statusCode = 504; // Gateway Timeout
    errorMessage = 'IMAP Connection Timeout';
    hint = 'Koneksi ke server IMAP Gmail terhenti. Coba lagi dalam beberapa saat.';
  }

  return { statusCode, errorMessage, hint, detail: error.message };
}

export default async function handler(req, res) {
  // Polyfill for res.json if not present (for local express compatibility)
  if (!res.json) {
    res.json = data => {
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(data, null, 2));
    };
  }

  try {
    await runMiddleware(req, res, cors());

    if (req.method !== 'POST') {
      return res.status(405).json({
        status: 'error',
        error: 'Method Not Allowed',
        message: 'Hanya method POST yang diizinkan untuk endpoint ini.',
        usage: {
          endpoint: '/api/check-inbox',
          method: 'POST',
          description: 'Mengecek inbox Gmail menggunakan IMAP dan Apps Password.',
          required_fields: ['apiKey', 'gmailUser', 'gmailAppPassword'],
          optional_fields: ['limit', 'uid', 'search'],
          example: {
            curl: `curl -X POST ${process.env.BASE_URL || 'http://localhost:3000'}/api/check-inbox \\
  -H "Content-Type: application/json" \\
  -d '{
    "apiKey": "YOUR_API_KEY",
    "gmailUser": "emailkamu@gmail.com",
    "gmailAppPassword": "abcd efgh ijkl mnop",
    "limit": 5
  }'`,
            response_success: {
              success: true,
              count: 1,
              emails: [
                {
                  uid: 123,
                  subject: 'Test Email',
                  from: 'sender@example.com',
                  date: '2023-10-27T10:00:00.000Z',
                  snippet: 'This is a snippet of the email body...',
                  text: 'This is the full text body of the email.',
                  html: '<p>This is the full <b>HTML</b> body of the email.</p>',
                },
              ],
            },
          },
        },
        author: 'Ipanzxdev',
      });
    }

    const { apiKey, gmailUser, gmailAppPassword, limit: rawLimit = 10, uid, search, from } = req.body;
    const limit = Math.min(Math.max(1, parseInt(rawLimit)), 50); // Cap limit between 1 and 50

    if (!apiKey) return res.status(401).json({ error: 'API Key required' });
    if (!gmailUser || !gmailAppPassword)
      return res.status(400).json({ error: 'Gmail credentials required' });

    const cleanedPassword = gmailAppPassword.replace(/\s/g, '');
    const isAdmin = apiKey === process.env.ADMIN_API_KEY;
    let isValid = false;

    if (!isAdmin) {
      await connectDB();
      const keyData = await ApiKey.findOneActive(apiKey);
      if (keyData) {
        isValid = true;
        if (keyData.expiresAt && new Date() > keyData.expiresAt) {
          await ApiKey.deactivate(apiKey);
          isValid = false;
        }
      }
    } else {
      isValid = true;
    }

    if (!isValid) return res.status(401).json({ error: 'Invalid or expired API Key' });

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: gmailUser,
        pass: cleanedPassword,
      },
      logger: false,
      tls: {
        // do not reject unauthorized certs
        rejectUnauthorized: false,
      },
      ...IMAP_TIMEOUTS,
    });

    const work = accessInbox(client, { uid, limit, from, search });
    work.catch(() => {}); // swallow late failures once the deadline has already fired
    const outcome = await withDeadline(work, DEADLINE_MS);
    return res.status(outcome.status).json(outcome.json);
  } catch (error) {
    console.error('IMAP Error:', error);
    const mapped = mapError(error);
    res.status(mapped.statusCode).json({
      status: 'error',
      error: mapped.errorMessage,
      detail: mapped.detail,
      hint: mapped.hint,
    });
  }
}