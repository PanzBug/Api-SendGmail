import test from 'node:test';
import assert from 'node:assert/strict';
import { runInbox, accessInbox, withDeadline, mapError } from '../api/check-inbox.js';

const RFC822 = [
  'From: Sender <sender@example.com>',
  'To: receiver@example.com',
  'Subject: Hello Bot',
  'Date: Tue, 20 Aug 2026 10:00:00 +0700',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Ini isi email lengkap untuk dibaca.',
].join('\r\n');

const readStream = async function* (text) {
  yield Buffer.from(text);
};

function listClient(messages) {
  return {
    mailbox: { exists: messages.length },
    async *fetch() {
      for (const m of messages) yield m;
    },
    async download() {
      return { content: readStream('Ini snippet teks dari badan email.') };
    },
  };
}

test('runInbox list: fills snippet, sorts desc by seq', async () => {
  const client = listClient([
    { uid: 1, seq: 3, envelope: { subject: 'A', from: [{ address: 'a@x.com' }], to: [{ address: 't@x.com' }], date: 'd', messageId: 'm1' }, bodyStructure: { type: 'text/plain', part: '1' } },
    { uid: 2, seq: 2, envelope: { subject: 'B', from: [{ address: 'b@x.com' }], to: [{ address: 't@x.com' }], date: 'd', messageId: 'm2' }, bodyStructure: { type: 'text/plain', part: '1' } },
    { uid: 3, seq: 1, envelope: { subject: 'C', from: [{ address: 'c@x.com' }], to: [{ address: 't@x.com' }], date: 'd', messageId: 'm3' }, bodyStructure: { type: 'text/plain', part: '1' } },
  ]);

  const { status, json } = await runInbox(client, { limit: 10 });

  assert.equal(status, 200);
  assert.equal(json.count, 3);
  assert.equal(json.total_inbox, 3);
  assert.deepEqual(json.emails.map(e => e.seq), [3, 2, 1]);
  assert.ok(json.emails.every(e => e.snippet.includes('Ini snippet teks')));
});

test('runInbox list: message without text part gets empty snippet', async () => {
  const client = listClient([
    { uid: 9, seq: 1, envelope: { subject: 'NoText', from: [{ address: 'a@x.com' }] }, bodyStructure: { type: 'multipart/mixed', childNodes: [{ type: 'application/pdf', part: '2' }] } },
  ]);

  const { status, json } = await runInbox(client, { limit: 10 });

  assert.equal(status, 200);
  assert.equal(json.emails[0].snippet, '');
});

test('runInbox list: empty inbox returns count 0', async () => {
  const client = listClient([]);
  const { status, json } = await runInbox(client, { limit: 10 });
  assert.equal(status, 200);
  assert.equal(json.count, 0);
  assert.match(json.message, /Kotak masuk kosong/);
});

test('runInbox uid: parses source and only requests bounded bytes', async () => {
  const calls = [];
  const client = {
    async fetchOne(seq, query, options) {
      calls.push({ seq, query, options });
      return { uid: 5, source: Buffer.from(RFC822) };
    },
  };

  const { status, json } = await runInbox(client, { uid: 5 });

  assert.equal(status, 200);
  assert.equal(json.email.uid, 5);
  assert.equal(json.email.subject, 'Hello Bot');
  assert.equal(json.email.from, '"Sender" <sender@example.com>');
  assert.equal(json.email.text.trim(), 'Ini isi email lengkap untuk dibaca.');
  assert.deepEqual(calls[0].query.source, { maxLength: 200 * 1024 });
});

test('runInbox uid: unknown uid returns 404', async () => {
  const client = { async fetchOne() { return false; } };
  const { status } = await runInbox(client, { uid: 999 });
  assert.equal(status, 404);
});

test('accessInbox: logout/release failure does not mask success', async () => {
  const client = {
    async connect() {},
    async getMailboxLock() {
      return {
        release() {
          throw new Error('release exploded');
        },
      };
    },
    async logout() {
      throw new Error('logout exploded');
    },
    async fetchOne() {
      return { uid: 5, source: Buffer.from(RFC822) };
    },
  };

  const { status, json } = await accessInbox(client, { uid: 5 });
  assert.equal(status, 200);
  assert.equal(json.email.subject, 'Hello Bot');
});

test('withDeadline rejects when work hangs past the deadline', async () => {
  await assert.rejects(
    withDeadline(new Promise(() => {}), 30),
    err => err.code === 'INBOX_DEADLINE' && /timed out/.test(err.message)
  );
});

test('mapError: timeout -> 504, auth -> 401, other -> 500', () => {
  assert.equal(mapError(new Error('IMAP operation timed out')).statusCode, 504);
  assert.equal(mapError(new Error('Connection timed out')).statusCode, 504);
  assert.equal(mapError(new Error('AUTHENTICATIONFAILED invalid credentials')).statusCode, 401);
  assert.equal(mapError(new Error('something else')).statusCode, 500);
});

test('runInbox list: skips downloading snippets after 10 messages for performance', async () => {
  const messages = [];
  for (let i = 1; i <= 15; i++) {
    messages.push({
      uid: i,
      seq: i,
      envelope: { subject: `Subj ${i}`, from: [{ address: 'sender@x.com' }], to: [{ address: 'rec@x.com' }], date: 'date', messageId: `msg-${i}` },
      bodyStructure: { type: 'text/plain', part: '1' }
    });
  }

  let downloadCount = 0;
  const client = {
    mailbox: { exists: 15 },
    async *fetch() {
      for (const m of messages) yield m;
    },
    async download() {
      downloadCount++;
      return { content: readStream('Ini snippet teks dari badan email.') };
    },
  };

  const { status, json } = await runInbox(client, { limit: 15 });

  assert.equal(status, 200);
  assert.equal(json.count, 15);
  assert.equal(downloadCount, 10);

  const skippedCount = json.emails.filter(e => e.snippet.includes('Cuplikan dilewati')).length;
  assert.equal(skippedCount, 5);
});