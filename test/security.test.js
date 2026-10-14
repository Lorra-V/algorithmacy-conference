const test = require('node:test');
const assert = require('node:assert/strict');
const cron = require('../handlers/cron');
const { identityFromDecoded } = require('../lib/portal/auth');
const { REFRESH_TTL_MS } = require('../lib/portal/db');
const core = require('../lib/submission-core');

test('the cron secret is compared in constant time and rejects a short header', () => {
  assert.equal(cron.bearerMatches('Bearer secret-value', 'secret-value'), true);
  assert.equal(cron.bearerMatches('Bearer secret-value', 'secret-valuE'), false);
  assert.equal(cron.bearerMatches('Bearer x', 'secret-value'), false);
  assert.equal(cron.bearerMatches('Bearer secret-value', ''), false);
});

test('an unverified sign-in is rejected', () => {
  assert.throws(
    () => identityFromDecoded({ uid: 'u', email: 'ada@example.com', email_verified: false }),
    { status: 401 },
  );
  const row = identityFromDecoded({ uid: 'u', email: 'Ada@Example.com', email_verified: true, name: 'Ada' });
  assert.equal(row.email, 'ada@example.com');
  assert.equal(row.name, 'Ada');
});

test('an assistant refresh lasts 14 days', () => {
  assert.equal(REFRESH_TTL_MS, 14 * 24 * 60 * 60 * 1000);
});

test('the rate limit fails closed when the store is down', async () => {
  const previous = global.fetch;
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
  global.fetch = async () => { throw new Error('down'); };
  try {
    await assert.rejects(
      () => core.enforceRate({ bucket: 'security-test' }),
      (err) => err.status === 503,
    );
  } finally {
    global.fetch = previous;
  }
});
