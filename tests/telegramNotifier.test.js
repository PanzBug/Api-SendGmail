import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

const calls = [];
const behavior = { failChatIds: new Set() };

const installAxiosMock = () => {
  calls.length = 0;
  behavior.failChatIds.clear();
  const original = axios.post.bind(axios);
  axios.post = async (url, body, opts) => {
    calls.push({ url, body, opts });
    if (behavior.failChatIds.has(String(body.chat_id))) {
      throw new Error(`mock: blocked chat ${body.chat_id}`);
    }
    return { data: { ok: true } };
  };
  return () => { axios.post = original; };
};

const cleanupNotifierEnv = () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.ADMIN_CHAT_ID;
  delete process.env.ADMIN_API_KEY;
};

const setEnv = (overrides) => {
  cleanupNotifierEnv();
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== null && v !== undefined) process.env[k] = v;
  }
};

const loadNotifier = async (envOverrides) => {
  setEnv(envOverrides);
  return await import(`../utils/telegramNotifier.js?bust=${Date.now()}-${Math.random()}`);
};

describe('telegramNotifier.notifyEmailSent', () => {
  let uninstallMock;

  beforeEach(() => {
    uninstallMock = installAxiosMock();
  });

  afterEach(() => {
    uninstallMock?.();
    cleanupNotifierEnv();
  });

  it('returns missing_token when TELEGRAM_BOT_TOKEN is unset', async () => {
    const { notifyEmailSent } = await loadNotifier({
      TELEGRAM_BOT_TOKEN: null,
      ADMIN_CHAT_ID: '111'
    });
    const result = await notifyEmailSent({
      apiKey: 'any', from: 'a@gmail.com', to: 'b@gmail.com', subject: 'Hi', body: 'Hello'
    });
    assert.deepEqual(result, { ok: false, reason: 'missing_token' });
    assert.equal(calls.length, 0);
  });

  it('returns missing_chat_id when ADMIN_CHAT_ID is unset', async () => {
    const { notifyEmailSent } = await loadNotifier({
      TELEGRAM_BOT_TOKEN: 'TEST_BOT_TOKEN',
      ADMIN_CHAT_ID: null
    });
    const result = await notifyEmailSent({
      apiKey: 'any', from: 'a@gmail.com', to: 'b@gmail.com', subject: 'Hi', body: 'Hello'
    });
    assert.deepEqual(result, { ok: false, reason: 'missing_chat_id' });
    assert.equal(calls.length, 0);
  });

  it('sends to all admin chat IDs and formats message correctly', async () => {
    const { notifyEmailSent } = await loadNotifier({
      TELEGRAM_BOT_TOKEN: 'TEST_BOT_TOKEN',
      ADMIN_CHAT_ID: '111,222',
      ADMIN_API_KEY: 'SUPER_SECRET_ADMIN_KEY'
    });

    const apiKey = '1234567890abcdef1234567890abcdef';
    const result = await notifyEmailSent({
      apiKey, from: 'sender@gmail.com', to: 'receiver@example.com',
      subject: 'Test Subject', body: '<b>Hello World</b>'
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.telegram.org/botTEST_BOT_TOKEN/sendMessage');
    assert.equal(calls[0].body.chat_id, '111');
    assert.equal(calls[1].body.chat_id, '222');
    assert.equal(calls[0].body.parse_mode, 'Markdown');
    assert.equal(calls[0].body.disable_web_page_preview, true);

    const text = calls[0].body.text;
    assert.match(text, /📨 \*Email Berhasil Dikirim\*/);
    assert.match(text, /sender@gmail\.com/);
    assert.match(text, /receiver@example\.com/);
    assert.match(text, /Test Subject/);
    assert.match(text, /Hello World/);
    assert.match(text, /👤 User/);
    assert.match(text, /123456(\\\*|\*)+abcdef/);
    assert.match(text, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.equal(result.ok, true);
    assert.equal(result.sent, 2);
    assert.equal(result.total, 2);
  });

  it('marks sender as Admin when apiKey matches ADMIN_API_KEY', async () => {
    const { notifyEmailSent } = await loadNotifier({
      TELEGRAM_BOT_TOKEN: 'TEST_BOT_TOKEN',
      ADMIN_CHAT_ID: '111',
      ADMIN_API_KEY: 'SUPER_SECRET_ADMIN_KEY'
    });

    await notifyEmailSent({
      apiKey: 'SUPER_SECRET_ADMIN_KEY',
      from: 'boss@gmail.com', to: 'x@gmail.com',
      subject: 'Admin Test', body: 'admin body'
    });

    const text = calls[0].body.text;
    assert.match(text, /👑 Admin/);
    assert.doesNotMatch(text, /👤 User/);
  });

  it('truncates very long message body', async () => {
    const { notifyEmailSent } = await loadNotifier({
      TELEGRAM_BOT_TOKEN: 'TEST_BOT_TOKEN',
      ADMIN_CHAT_ID: '111'
    });
    const huge = 'A'.repeat(3000);
    await notifyEmailSent({
      apiKey: 'k', from: 'a@gmail.com', to: 'b@gmail.com',
      subject: 'big', body: huge
    });
    const text = calls[0].body.text;
    assert.match(text, /\.\.\.|\(truncated\)|…\(truncated\)/);
    assert.ok(text.length < 2200, `message length ${text.length} should be < 2200`);
  });

  it('reports partial failure but still attempts other chats', async () => {
    const { notifyEmailSent } = await loadNotifier({
      TELEGRAM_BOT_TOKEN: 'TEST_BOT_TOKEN',
      ADMIN_CHAT_ID: '111,222'
    });
    behavior.failChatIds.add('111');

    const result = await notifyEmailSent({
      apiKey: 'k', from: 'a@gmail.com', to: 'b@gmail.com',
      subject: 's', body: 'b'
    });

    assert.equal(result.ok, false);
    assert.equal(result.total, 2);
    assert.equal(result.sent, 1);
  });

  it('tolerates whitespace and commas in ADMIN_CHAT_ID', async () => {
    const { notifyEmailSent } = await loadNotifier({
      TELEGRAM_BOT_TOKEN: 'TEST_BOT_TOKEN',
      ADMIN_CHAT_ID: ' 111 ,, ,222,'
    });
    await notifyEmailSent({
      apiKey: 'k', from: 'a@gmail.com', to: 'b@gmail.com',
      subject: 's', body: 'b'
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.chat_id, '111');
    assert.equal(calls[1].body.chat_id, '222');
  });

  it('renders HTML body inside triple-backtick code block', async () => {
    const { notifyEmailSent } = await loadNotifier({
      TELEGRAM_BOT_TOKEN: 'TEST_BOT_TOKEN',
      ADMIN_CHAT_ID: '111'
    });
    await notifyEmailSent({
      apiKey: 'k', from: 'a@gmail.com', to: 'b@gmail.com',
      subject: 'html', body: '<h1>Hi</h1>'
    });
    const text = calls[0].body.text;
    assert.match(text, /```\n<h1>Hi<\/h1>\n```/);
  });
});
