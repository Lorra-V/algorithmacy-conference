const test = require('node:test');
const assert = require('node:assert/strict');
const { callHandler } = require('../lib/next/call-handler');
const { readRaw, send } = require('../lib/portal/http');

test('the adapter gives Stripe the unmodified body', async () => {
  const payload = Buffer.from('{"id":"evt_1"}');
  const handler = async (req, res) => {
    const raw = await readRaw(req);
    assert.equal(req.headers['stripe-signature'], 't=1,v1=abc');
    send(res, 200, { text: raw.toString('utf8') });
  };
  const response = await callHandler(handler, new Request('http://localhost/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=abc', 'content-type': 'application/json' },
    body: payload,
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.text, payload.toString('utf8'));
});

test('the adapter preserves res.json status codes', async () => {
  const submit = require('../api/submit');
  const response = await callHandler(submit, new Request('http://localhost/api/submit', { method: 'GET' }));
  assert.equal(response.status, 405);
  const data = await response.json();
  assert.match(data.error, /not allowed/i);
});

test('the adapter rejects a public booking with a bad email', async () => {
  const book = require('../api/book');
  const response = await callHandler(book, new Request('http://localhost/api/book', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Ada',
      email: 'not-an-email',
      business: 'Ada Law',
      type: 'discovery',
      start: '2026-07-15T14:00:00.000Z',
    }),
  }));
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.match(data.error, /email/i);
});

test('portal config is reachable through the route segments', async () => {
  const portal = require('../api/portal');
  const response = await callHandler(
    portal,
    new Request('http://localhost/api/portal/config'),
    { route: ['config'] },
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(typeof data.configured, 'boolean');
});
