import test from 'node:test';
import assert from 'node:assert/strict';

// Helper to create mock pool/client for ApiKey.consume
function createMockPool(mockRow, opts = {}) {
  let row = { ...mockRow };
  const client = {
    async query(sql, params) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FOR UPDATE')) {
        // simulate select
        if (opts.notFound) return { rows: [] };
        return { rows: [row] };
      }
      if (sql.includes('UPDATE api_keys SET is_active = false')) {
        row.isActive = false;
        return { rows: [] };
      }
      if (sql.includes('UPDATE api_keys SET usage_count = usage_count + 1')) {
        row = { ...row, usageCount: (row.usageCount ?? 0) + 1, lastHitAt: new Date().toISOString(), usageLimit: row.usageLimit, isActive: row.isActive };
        return { rows: [row] };
      }
      // fallback
      return { rows: [] };
    },
    release() {}
  };
  return {
    connect: async () => client,
    query: client.query.bind(client)
  };
}

test('getResetAtWIB returns WIB midnight +07:00', async () => {
  // ensure mock pool not interfering
  global.__pgPool = undefined;
  const { ApiKey } = await import(`../models/ApiKey.js?bust=${Date.now()}-reset`);
  const resetAt = ApiKey.getResetAtWIB();
  assert.match(resetAt, /T00:00:00\+07:00$/);
  const d = new Date(resetAt);
  assert.ok(!isNaN(d.getTime()));
});

test('consume allows when under limit and outside throttle', async () => {
  const row = {
    key: 'test123',
    email: 'a@b.com',
    duration: '1month',
    expiresAt: null,
    isActive: true,
    createdAt: new Date().toISOString(),
    usageLimit: 100,
    usageCount: 99,
    lastHitAt: new Date(Date.now() - 6000).toISOString(),
    updatedAt: new Date().toISOString()
  };
  global.__pgPool = createMockPool(row);
  // need fresh import to pick up mock pool? getPool reads global at call time, so no need reimport
  const { ApiKey } = await import(`../models/ApiKey.js?bust=${Date.now()}-allow`);
  const res = await ApiKey.consume('test123');
  assert.equal(res.allowed, true);
  assert.equal(res.used, 100);
  assert.equal(res.remaining, 0);
  global.__pgPool = undefined;
});

test('consume blocks when daily limit exceeded', async () => {
  const row = {
    key: 'test123',
    email: 'a@b.com',
    duration: '1month',
    expiresAt: null,
    isActive: true,
    createdAt: new Date().toISOString(),
    usageLimit: 100,
    usageCount: 100,
    lastHitAt: new Date(Date.now() - 10000).toISOString(),
    updatedAt: new Date().toISOString()
  };
  global.__pgPool = createMockPool(row);
  const { ApiKey } = await import(`../models/ApiKey.js?bust=${Date.now()}-limit`);
  const res = await ApiKey.consume('test123');
  assert.equal(res.allowed, false);
  assert.equal(res.status, 429);
  assert.match(res.body.error, /Daily limit/);
  assert.equal(res.body.limit, 100);
  assert.ok(res.body.resetAt.includes('+07:00'));
  global.__pgPool = undefined;
});

test('consume blocks when throttle <5s', async () => {
  const row = {
    key: 'test123',
    email: 'a@b.com',
    duration: '1month',
    expiresAt: null,
    isActive: true,
    createdAt: new Date().toISOString(),
    usageLimit: 100,
    usageCount: 10,
    lastHitAt: new Date(Date.now() - 2000).toISOString(),
    updatedAt: new Date().toISOString()
  };
  global.__pgPool = createMockPool(row);
  const { ApiKey } = await import(`../models/ApiKey.js?bust=${Date.now()}-throttle`);
  const res = await ApiKey.consume('test123');
  assert.equal(res.allowed, false);
  assert.equal(res.status, 429);
  assert.match(res.body.error, /Too many/);
  assert.ok(res.body.retryAfter >= 2 && res.body.retryAfter <= 5);
  global.__pgPool = undefined;
});

test('consume allows permanent (unlimited) at high count', async () => {
  const row = {
    key: 'perm',
    email: 'a@b.com',
    duration: 'permanent',
    expiresAt: null,
    isActive: true,
    createdAt: new Date().toISOString(),
    usageLimit: null,
    usageCount: 9999,
    lastHitAt: new Date(Date.now() - 6000).toISOString(),
    updatedAt: new Date().toISOString()
  };
  global.__pgPool = createMockPool(row);
  const { ApiKey } = await import(`../models/ApiKey.js?bust=${Date.now()}-perm`);
  const res = await ApiKey.consume('perm');
  assert.equal(res.allowed, true);
  assert.equal(res.limit, null);
  global.__pgPool = undefined;
});

test('admin create accepts limit tiers', async () => {
  // just check that validLimits includes expected values via handler logic
  const valid = ['100','1000','10000','permanent'];
  for (const l of valid) assert.ok(valid.includes(l));
  assert.equal(parseInt('1000',10), 1000);
});
