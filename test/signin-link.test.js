const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const store = require('../lib/portal/db');
const { dispatch } = require('../lib/portal/handlers');

const EMAIL = 'ada.missing@example.com';

function addressHash(email) {
  return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 12);
}

function mockRes() {
  let body = '';
  return {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { body = s; this.writableEnded = true; },
    writableEnded: false,
    json() { return JSON.parse(body); },
  };
}

async function postLink(body, ip) {
  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => { logs.push(args); };
  const res = mockRes();
  try {
    await dispatch({
      method: 'POST',
      url: '/api/portal?path=auth/link',
      query: { path: 'auth/link' },
      headers: ip ? { 'x-forwarded-for': ip } : {},
      body,
    }, res);
  } finally {
    console.info = originalInfo;
  }
  return { res, logs };
}

test('skipped sign-in links log a reason and a hash, not the email', async (t) => {
  const previousFirebase = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const previousAdmins = process.env.STUDIO_ADMIN_EMAILS;
  const previousRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const accountForEmail = store.accountForEmail;
  const invites = store.invites;
  const engineerInviteFor = store.engineerInviteFor;
  const originalFetch = global.fetch;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousFirebase || '{"project_id":"test"}';
  process.env.STUDIO_ADMIN_EMAILS = '';
  process.env.UPSTASH_REDIS_REST_URL = previousRedisUrl || 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = previousRedisToken || 'test-redis-token';
  store.accountForEmail = async () => null;
  store.invites = () => ({ where: () => ({ get: async () => ({ docs: [] }) }) });
  global.fetch = async () => Response.json({ result: 1 });
  t.after(() => {
    store.accountForEmail = accountForEmail;
    store.invites = invites;
    store.engineerInviteFor = engineerInviteFor;
    global.fetch = originalFetch;
    if (previousFirebase === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousFirebase;
    if (previousAdmins === undefined) delete process.env.STUDIO_ADMIN_EMAILS;
    else process.env.STUDIO_ADMIN_EMAILS = previousAdmins;
    if (previousRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousRedisUrl;
    if (previousRedisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousRedisToken;
  });

  store.engineerInviteFor = async () => ({ name: 'Ada Missing', email: EMAIL });
  const unpublished = await postLink({ email: EMAIL }, '203.0.113.10');
  assert.equal(unpublished.res.statusCode, 200);
  assert.deepEqual(unpublished.res.json(), { ok: true });
  assert.deepEqual(unpublished.logs, [[
    'signin link skipped',
    { address: addressHash(EMAIL), reason: 'engineer profile is not published' },
  ]]);
  assert.equal(JSON.stringify(unpublished.logs).includes(EMAIL), false);

  store.engineerInviteFor = async () => null;
  const unknown = await postLink({ email: 'nobody@example.com' }, '203.0.113.11');
  assert.equal(unknown.res.statusCode, 200);
  assert.deepEqual(unknown.res.json(), { ok: true });
  assert.deepEqual(unknown.logs, [[
    'signin link skipped',
    { address: addressHash('nobody@example.com'), reason: 'no account, pending invite, or admin role' },
  ]]);
  assert.equal(JSON.stringify(unknown.logs).includes('nobody@example.com'), false);

  const honeypot = await postLink({ email: EMAIL, website: 'https://spam.example' });
  assert.equal(honeypot.res.statusCode, 200);
  assert.deepEqual(honeypot.res.json(), { ok: true });
  assert.deepEqual(honeypot.logs, [[
    'signin link skipped',
    { address: addressHash(EMAIL), reason: 'honeypot' },
  ]]);
  assert.equal(JSON.stringify(honeypot.logs).includes(EMAIL), false);
});
