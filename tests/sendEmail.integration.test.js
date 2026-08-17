import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';
import axios from 'axios';

const calls = { telegram: [], gmail: [] };
const behavior = { failTelegram: false };

const installAxiosMock = () => {
  calls.telegram.length = 0;
  behavior.failTelegram = false;
  const original = axios.post.bind(axios);
  axios.post = async (url, body, opts) => {
    if (String(url).includes('api.telegram.org')) {
      calls.telegram.push({ url, body, opts });
      if (behavior.failTelegram) throw new Error('mock telegram failure');
      return { data: { ok: true } };
    }
    return { data: { ok: true } };
  };
  return () => { axios.post = original; };
};

const restoreAxios = () => {};

const cleanup = () => {
  delete process.env.DATABASE_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.ADMIN_CHAT_ID;
  delete process.env.ADMIN_API_KEY;
  delete process.env.BASE_URL;
};

const makeReqRes = ({ body = {}, method = 'POST' } = {}) => {
  const req = { method, body, headers: { 'content-type': 'application/json' } };
  let statusCode = 200;
  let responseData = null;
  const res = {
    setHeader: () => {},
    send: (data) => { responseData = data; return data; },
    status: function (c) { statusCode = c; return this; },
    json: function (d) { responseData = d; return this; },
    end: () => {}
  };
  return { req, res, getStatus: () => statusCode, getData: () => responseData };
};

const makeMultipartReqRes = ({ fields = {}, file = null } = {}) => {
  const boundary = '----TestBoundary' + Math.random().toString(36).slice(2);
  const parts = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
    ));
  }

  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`
    ));
    parts.push(file.buffer);
    parts.push(Buffer.from('\r\n'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const bodyBuffer = Buffer.concat(parts);

  const req = new Readable({
    read() {
      this.push(bodyBuffer);
      this.push(null);
    }
  });
  req.method = 'POST';
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };

  let statusCode = 200;
  let responseData = null;
  const res = {
    setHeader: () => {},
    send: (data) => { responseData = data; return data; },
    status: function (c) { statusCode = c; return this; },
    json: function (d) { responseData = d; return this; },
    end: () => {}
  };
  return { req, res, getStatus: () => statusCode, getData: () => responseData };
};

const patchNodemailer = () => {
  return new Promise(async (resolve) => {
    const nm = await import('nodemailer');
    const originalCreate = nm.default.createTransport.bind(nm.default);
    nm.default.createTransport = (opts) => {
      calls.gmail.push(opts);
      return {
        sendMail: async (mailOpts) => {
          calls.gmail.push({ mail: mailOpts });
          return { messageId: '<mock-msg@gmail.com>' };
        }
      };
    };
    resolve(() => { nm.default.createTransport = originalCreate; });
  });
};

const waitForTransporterPatch = () => {
  // warms up nodemailer import and patches default.createTransport
  return patchNodemailer();
};

describe('send-email handler integration', () => {
  let uninstallAxios;
  let restoreTransporter;
  let patchPromise;

  beforeEach(async () => {
    uninstallAxios = installAxiosMock();
    process.env.DATABASE_URL = 'postgres://mock:mock@localhost:5432/test';
    process.env.TELEGRAM_BOT_TOKEN = 'TEST_BOT_TOKEN';
    process.env.ADMIN_CHAT_ID = 'OWNER_A,OWNER_B';
    process.env.ADMIN_API_KEY = 'ADMIN_KEY_777';
    process.env.BASE_URL = 'https://api.example.com';
    calls.gmail.length = 0;
    patchPromise = waitForTransporterPatch();
  });

  afterEach(async () => {
    const restore = await patchPromise;
    restore?.();
    uninstallAxios?.();
    cleanup();
  });

  it('rejects non-POST', async () => {
    const m = await import(`../api/send-email.js?bust=${Date.now()}-${Math.random()}`);
    const { req, res, getStatus } = makeReqRes({ method: 'GET' });
    await m.default(req, res);
    assert.equal(getStatus(), 405);
  });

  it('401 when apiKey missing', async () => {
    const m = await import(`../api/send-email.js?bust=${Date.now()}-${Math.random()}`);
    const { req, res, getStatus } = makeReqRes({
      body: { to: 'x@y.com', subject: 'y', text: 'z', gmailUser: 'a@gmail.com', gmailAppPassword: 'pwd' }
    });
    await m.default(req, res);
    assert.equal(getStatus(), 401);
  });

  it('does NOT call telegram when API key is invalid', async () => {
    const m = await import(`../api/send-email.js?bust=${Date.now()}-${Math.random()}`);
    const { req, res } = makeReqRes({
      body: {
        apiKey: 'definitely-not-valid-1234567890abcdef',
        to: 'x@y.com', subject: 'y', text: 'z',
        gmailUser: 'a@gmail.com', gmailAppPassword: 'pwd'
      }
    });
    await m.default(req, res);

    assert.equal(calls.telegram.length, 0, 'no telegram calls should be made when send-email fails');
    const gmailCalls = calls.gmail.filter(c => c.mail);
    assert.equal(gmailCalls.length, 0, 'no gmail send should be triggered for invalid key');
  });

  it('sends telegram notification when admin API key matches', async () => {
    behavior.failTelegram = false;
    const m = await import(`../api/send-email.js?bust=${Date.now()}-${Math.random()}-admin`);
    const { req, res, getStatus, getData } = makeReqRes({
      body: {
        apiKey: 'ADMIN_KEY_777',
        to: 'receiver@example.com',
        subject: 'Hello Subject',
        text: 'Plain text body',
        gmailUser: 'sender@gmail.com',
        gmailAppPassword: 'abcd efgh ijkl mnop'
      }
    });
    await m.default(req, res);

    assert.equal(getStatus(), 200, `handler returned ${getStatus()}`);
    const data = getData();
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    assert.match(serialized, /"success":\s*true/, `expected success:true in response, got: ${serialized}`);
    assert.match(serialized, /<mock-msg@gmail\.com>/);

    const gmailCalls = calls.gmail.filter(c => c.mail);
    assert.equal(gmailCalls.length, 1);
    assert.equal(gmailCalls[0].mail.from, '"sender@gmail.com" <sender@gmail.com>');
    assert.equal(gmailCalls[0].mail.to, 'receiver@example.com');
    assert.equal(gmailCalls[0].mail.subject, 'Hello Subject');

    assert.equal(calls.telegram.length, 2, 'should send to both admin chat IDs');
    const chatIds = calls.telegram.map(c => c.body.chat_id);
    assert.ok(chatIds.includes('OWNER_A'));
    assert.ok(chatIds.includes('OWNER_B'));

    const firstText = calls.telegram[0].body.text;
    assert.match(firstText, /📨 \*Email Berhasil Dikirim\*/);
    assert.match(firstText, /sender@gmail\.com/);
    assert.match(firstText, /receiver@example\.com/);
    assert.match(firstText, /Hello Subject/);
    assert.match(firstText, /Plain text body/);
    assert.match(firstText, /👑 Admin/);
  });

  it('still returns 200 to client if telegram fails (does not break send-email)', async () => {
    behavior.failTelegram = true;
    const m = await import(`../api/send-email.js?bust=${Date.now()}-${Math.random()}-fail`);
    const { req, res, getStatus, getData } = makeReqRes({
      body: {
        apiKey: 'ADMIN_KEY_777',
        to: 'receiver@example.com',
        subject: 'subj',
        text: 'msg',
        gmailUser: 'sender@gmail.com',
        gmailAppPassword: 'pwd'
      }
    });
    await m.default(req, res);

    assert.equal(getStatus(), 200);
    const data = getData();
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    assert.match(serialized, /"success":\s*true/, `expected success:true in response, got: ${serialized}`);
    const gmailCalls = calls.gmail.filter(c => c.mail);
    assert.equal(gmailCalls.length, 1);
    assert.equal(calls.telegram.length, 2);
  });

  it('preserves text formatting when no html is provided (JSON)', async () => {
    const m = await import(`../api/send-email.js?bust=${Date.now()}-${Math.random()}-txtfmt`);
    const { req, res, getStatus } = makeReqRes({
      body: {
        apiKey: 'ADMIN_KEY_777',
        to: 'receiver@example.com',
        subject: 'Format Test',
        text: 'Halo,\n\nIni adalah pesan dengan link: https://example.com\nSilakan cek.\n\nTerima kasih.',
        gmailUser: 'sender@gmail.com',
        gmailAppPassword: 'abcd efgh ijkl mnop'
      }
    });
    await m.default(req, res);

    assert.equal(getStatus(), 200);

    const gmailCalls = calls.gmail.filter(c => c.mail);
    assert.equal(gmailCalls.length, 1);

    const mailOpts = gmailCalls[0].mail;
    assert.equal(mailOpts.text, 'Halo,\n\nIni adalah pesan dengan link: https://example.com\nSilakan cek.\n\nTerima kasih.');
    assert.equal(mailOpts.html, undefined, 'html should NOT be set when only text is provided');
  });

  it('sends email with photo attachment via multipart/form-data', async () => {
    const photoBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const m = await import(`../api/send-email.js?bust=${Date.now()}-${Math.random()}-photo`);
    const { req, res, getStatus, getData } = makeMultipartReqRes({
      fields: {
        apiKey: 'ADMIN_KEY_777',
        to: 'receiver@example.com',
        subject: 'With Photo',
        text: 'Halo,\nIni pesan dengan foto.',
        gmailUser: 'sender@gmail.com',
        gmailAppPassword: 'abcd efgh ijkl mnop'
      },
      file: {
        fieldname: 'photo',
        filename: 'foto.jpg',
        mimeType: 'image/jpeg',
        buffer: photoBuffer
      }
    });
    await m.default(req, res);

    assert.equal(getStatus(), 200);
    const data = getData();
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    assert.match(serialized, /"success":\s*true/);

    const gmailCalls = calls.gmail.filter(c => c.mail);
    assert.equal(gmailCalls.length, 1);

    const mailOpts = gmailCalls[0].mail;
    assert.equal(mailOpts.to, 'receiver@example.com');
    assert.equal(mailOpts.subject, 'With Photo');
    assert.equal(mailOpts.text, 'Halo,\nIni pesan dengan foto.');

    assert.ok(mailOpts.html, 'html should be auto-generated when photo is present');
    assert.ok(mailOpts.html.includes('cid:attached-photo'), 'html should reference the embedded photo cid');

    assert.ok(mailOpts.attachments, 'attachments array should exist');
    assert.equal(mailOpts.attachments.length, 1);
    assert.equal(mailOpts.attachments[0].filename, 'foto.jpg');
    assert.equal(mailOpts.attachments[0].contentType, 'image/jpeg');
    assert.equal(mailOpts.attachments[0].cid, 'attached-photo');
    assert.deepEqual(mailOpts.attachments[0].content, photoBuffer);
  });

  it('uses user html when html + photo are provided via multipart', async () => {
    const photoBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const m = await import(`../api/send-email.js?bust=${Date.now()}-${Math.random()}-htmlphoto`);
    const { req, res, getStatus } = makeMultipartReqRes({
      fields: {
        apiKey: 'ADMIN_KEY_777',
        to: 'r@x.com',
        subject: 'HTML+Photo',
        text: 'fallback text',
        html: '<b>Bold</b> message',
        gmailUser: 'sender@gmail.com',
        gmailAppPassword: 'pwd'
      },
      file: {
        fieldname: 'photo',
        filename: 'pic.jpg',
        mimeType: 'image/jpeg',
        buffer: photoBuffer
      }
    });
    await m.default(req, res);

    assert.equal(getStatus(), 200);
    const mailOpts = calls.gmail.filter(c => c.mail)[0].mail;

    assert.ok(mailOpts.html.includes('<b>Bold</b>'), 'user html should be preserved');
    assert.ok(mailOpts.html.includes('cid:attached-photo'), 'photo should be appended to user html');
    assert.equal(mailOpts.text, 'fallback text');
    assert.equal(mailOpts.attachments.length, 1);
  });

  it('rejects non-jpg file via multipart (no image/jpeg mime)', async () => {
    const m = await import(`../api/send-email.js?bust=${Date.now()}-${Math.random()}-badfile`);
    const { req, res, getStatus } = makeMultipartReqRes({
      fields: {
        apiKey: 'ADMIN_KEY_777',
        to: 'r@x.com',
        subject: 'Bad file',
        text: 'no photo',
        gmailUser: 'sender@gmail.com',
        gmailAppPassword: 'pwd'
      },
      file: {
        fieldname: 'photo',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from([0x25, 0x50, 0x44, 0x46])
      }
    });
    await m.default(req, res);

    assert.equal(getStatus(), 200);

    const mailOpts = calls.gmail.filter(c => c.mail)[0].mail;
    assert.equal(mailOpts.attachments, undefined, 'non-jpg files should not be attached');
    assert.equal(mailOpts.html, undefined, 'html should not be auto-generated without photo');
  });
});
