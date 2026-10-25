const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../handlers/studio.js');

const TOKEN = 'test-token-not-a-real-secret';
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'https://example.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'test-redis-token';

function installFetch(onMail) {
  const counts = new Map();
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    const raw = opts && opts.body;
    if (typeof raw === 'string' && raw.startsWith('[')) {
      const cmd = JSON.parse(raw);
      if (cmd[0] === 'INCR') {
        const n = (counts.get(cmd[1]) || 0) + 1;
        counts.set(cmd[1], n);
        return Response.json({ result: n });
      }
      return Response.json({ result: 1 });
    }
    return onMail(url, opts);
  };
  return () => { global.fetch = original; };
}

function validBody(overrides = {}) {
  return {
    intent: 'office',
    office: 'law firm',
    name: 'Ada Lovelace',
    business: 'Analytical Engines',
    email: 'ada@example.com',
    phone: '+1 617 555 0134',
    message: 'Intake and follow-ups are eating the week.',
    terms: true,
    started: Date.now() - 5000,
    hp_field: '',
    ...overrides,
  };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    json(payload) { this.body = payload; return this; },
  };
}

function mockReq(body, ip = '203.0.113.10') {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body,
  };
}

async function post(body, { ip, token = TOKEN } = {}) {
  const previous = process.env.HOSTINGER_MAIL_API_TOKEN;
  if (token === null) delete process.env.HOSTINGER_MAIL_API_TOKEN;
  else process.env.HOSTINGER_MAIL_API_TOKEN = token;
  const res = mockRes();
  try {
    await handler(mockReq(body, ip), res);
    return res;
  } finally {
    if (previous === undefined) delete process.env.HOSTINGER_MAIL_API_TOKEN;
    else process.env.HOSTINGER_MAIL_API_TOKEN = previous;
  }
}

test('sends the Hostinger request shape and treats 204 as success', async () => {
  let captured;
  const restore = installFetch(async (url, opts) => {
    captured = { url, opts };
    return new Response(null, { status: 204 });
  });
  try {
    const res = await post(validBody(), { ip: '203.0.113.21' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(captured.url, 'https://api.mail.hostinger.com/api/v1/mailboxes/ACb8a59b487c338fadf34425697bad/send');
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(captured.opts.headers['Content-Type'], 'application/json');
    assert.equal(captured.opts.headers.Accept, 'application/json');
    assert.equal(captured.opts.headers['User-Agent'], 'algorithmacy-studio-form/1.0 (+topanga@algorithmacy.org)');
    const payload = JSON.parse(captured.opts.body);
    assert.deepEqual(payload.to, ['topanga@algorithmacy.org']);
    assert.equal(payload.subject, 'Studio inquiry: Analytical Engines (law firm)');
    assert.equal(payload.subject.startsWith('Studio inquiry:'), true);
    assert.equal(payload.displayName, 'Algorithmacy Studio form');
    assert.equal(payload.text.startsWith('Reply to: ada@example.com\n'), true);
    assert.match(payload.text, /Email: ada@example.com/);
    assert.match(payload.text, /Phone: \+1 617 555 0134/);
    assert.match(payload.text, /Office type: law firm/);
    assert.match(payload.text, /Intake and follow-ups are eating the week\./);
    assert.match(payload.text, /Terms accepted: yes/);
    assert.match(payload.text, /Submitted: \d{4}-\d{2}-\d{2}T/);
    assert.equal(payload.replyTo, undefined);
    assert.equal(payload.html, undefined);
    assert.equal(JSON.stringify(res.body).includes(TOKEN), false);
    assert.equal(captured.opts.body.includes(TOKEN), false);
  } finally {
    restore();
  }
});

test('treats 200 and 202 as success', async () => {
  for (const status of [200, 202]) {
    const restore = installFetch(async () => new Response('{}', { status, headers: { 'content-type': 'application/json' } }));
    try {
      const res = await post(validBody({ email: `ok${status}@example.com` }), { ip: `203.0.113.${status}` });
      assert.equal(res.body.ok, true, `status ${status}`);
    } finally {
      restore();
    }
  }
});

test('does not send when the agreement box is missing', async () => {
  let called = false;
  const original = global.fetch;
  global.fetch = async () => { called = true; return new Response(null, { status: 204 }); };
  try {
    const res = await post(validBody({ terms: false }), { ip: '203.0.113.30' });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Terms of Service and Privacy Policy/);
    assert.equal(called, false);
  } finally {
    global.fetch = original;
  }
});

test('rejects an invalid email and an optional blank phone', async () => {
  const bad = await post(validBody({ email: 'not-an-email' }), { ip: '203.0.113.31' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error, /email/i);

  let captured;
  const restore = installFetch(async (url, opts) => {
    captured = JSON.parse(opts.body);
    return new Response(null, { status: 204 });
  });
  try {
    const res = await post(validBody({ phone: '   ', email: 'nophone@example.com' }), { ip: '203.0.113.32' });
    assert.equal(res.body.ok, true);
    assert.match(captured.text, /Phone: \(not provided\)/);
  } finally {
    restore();
  }
});

test('honeypot and too-fast submissions do not call Hostinger', async () => {
  let called = false;
  const original = global.fetch;
  global.fetch = async () => { called = true; return new Response(null, { status: 204 }); };
  try {
    const honey = await post(validBody({ hp_field: 'https://spam.example' }), { ip: '203.0.113.40' });
    assert.equal(honey.body.ok, true);
    assert.equal(called, false);

    const fast = await post(validBody({ started: Date.now() }), { ip: '203.0.113.41' });
    assert.equal(fast.statusCode, 400);
    assert.match(fast.body.error, /wait a moment/);
    assert.equal(called, false);
  } finally {
    global.fetch = original;
  }
});

test('missing token returns a friendly error and does not call Hostinger', async () => {
  let called = false;
  const restore = installFetch(async () => {
    called = true;
    return new Response(null, { status: 204 });
  });
  try {
    const res = await post(validBody({ email: 'missing-token@example.com' }), { ip: '203.0.113.50', token: null });
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /topanga@algorithmacy.org/);
    assert.equal(JSON.stringify(res.body).includes('HOSTINGER'), false);
    assert.equal(called, false);
  } finally {
    restore();
  }
});

test('upstream failure tells the visitor to email the studio', async () => {
  const restore = installFetch(async () => new Response('nope', { status: 500 }));
  try {
    const res = await post(validBody({ email: 'upstream@example.com' }), { ip: '203.0.113.51' });
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /topanga@algorithmacy.org/);
    assert.equal(JSON.stringify(res.body).includes(TOKEN), false);
  } finally {
    restore();
  }
});

test('accepts a home and still accepts an older office value', async () => {
  let captured;
  const restore = installFetch(async (url, opts) => {
    captured = JSON.parse(opts.body);
    return new Response(null, { status: 204 });
  });
  try {
    const home = await post(validBody({
      office: 'home or household',
      email: 'home@example.com',
      business: 'Chen household',
    }), { ip: '203.0.113.70' });
    assert.equal(home.body.ok, true);
    assert.equal(captured.subject, 'Studio inquiry: Chen household (home or household)');
    assert.match(captured.text, /Office type: home or household/);

    const older = await post(validBody({
      office: 'dental practice or med spa',
      email: 'older@example.com',
      business: 'Older Practice',
    }), { ip: '203.0.113.71' });
    assert.equal(older.body.ok, true);
  } finally {
    restore();
  }
});

test('other work uses that office type in the subject', async () => {
  let captured;
  const restore = installFetch(async (url, opts) => {
    captured = JSON.parse(opts.body);
    return new Response(null, { status: 204 });
  });
  try {
    const res = await post(validBody({
      intent: 'other',
      office: 'law firm',
      email: 'other@example.com',
      business: 'North Desk',
    }), { ip: '203.0.113.60' });
    assert.equal(res.body.ok, true);
    assert.equal(captured.subject, 'Studio inquiry: North Desk (other work)');
  } finally {
    restore();
  }
});

test('rate limit blocks a sixth submission from the same address', async () => {
  const restore = installFetch(async () => new Response(null, { status: 204 }));
  try {
    const ip = '198.51.100.77';
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await post(validBody({ email: `rate${i}@example.com`, message: `Message number ${i} is long enough.` }), { ip });
      assert.equal(last.body.ok, true, `attempt ${i}`);
    }
    last = await post(validBody({ email: 'rate-blocked@example.com', message: 'This one should be limited.' }), { ip });
    assert.equal(last.statusCode, 429);
    assert.match(last.body.error, /topanga@algorithmacy.org/);
  } finally {
    restore();
  }
});
