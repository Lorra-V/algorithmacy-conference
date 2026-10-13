const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSlots, zonedTimeToUtc, DEFAULT_AVAILABILITY } = require('../lib/portal/slots');
const { buildIcs } = require('../lib/portal/ics');
const {
  validateBook, validateEvent, validateSteps, validateAgent, validateAvailability, validateAccountCreate,
} = require('../lib/portal/validate');
const { routeParts } = require('../lib/portal/http');
const { previewAccess } = require('../lib/portal/preview');
const { slug, engineerInviteText } = require('../lib/portal/engineer');

test('10:00 in New York is 14:00 UTC in July and 15:00 UTC in November', () => {
  const summer = zonedTimeToUtc(2026, 7, 15, 10, 0, 'America/New_York');
  const winter = zonedTimeToUtc(2026, 11, 4, 10, 0, 'America/New_York');
  assert.equal(summer.toISOString(), '2026-07-15T14:00:00.000Z');
  assert.equal(winter.toISOString(), '2026-11-04T15:00:00.000Z');
});

test('weekday windows offer slots and skip weekends, busy time, and the lead time', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const slots = generateSlots({
    now,
    ...DEFAULT_AVAILABILITY,
    durationMin: 20,
    horizonDays: 1,
  });
  assert.ok(slots.length > 0);
  assert.equal(slots[0].start, '2026-07-15T14:00:00.000Z');
  const weekend = generateSlots({
    now: new Date('2026-07-18T14:00:00.000Z'),
    ...DEFAULT_AVAILABILITY,
    durationMin: 20,
    horizonDays: 1,
  });
  assert.equal(weekend.length, 0);
  const busy = generateSlots({
    now,
    ...DEFAULT_AVAILABILITY,
    durationMin: 20,
    horizonDays: 1,
    busy: [{ start: '2026-07-15T14:00:00.000Z', end: '2026-07-15T14:20:00.000Z' }],
  });
  assert.ok(busy.every((s) => s.start !== '2026-07-15T14:00:00.000Z'));
  assert.ok(busy.every((s) => s.start !== '2026-07-15T14:30:00.000Z'));
});

test('a closed exception removes that day', () => {
  const slots = generateSlots({
    now: new Date('2026-07-15T12:00:00.000Z'),
    ...DEFAULT_AVAILABILITY,
    durationMin: 20,
    horizonDays: 1,
    exceptions: [{ date: '2026-07-15', closed: true }],
  });
  assert.equal(slots.length, 0);
});

test('ics escapes commas and names the event', () => {
  const file = buildIcs({
    uid: 'abc@algorithmacy.org',
    start: '2026-07-15T14:00:00.000Z',
    end: '2026-07-15T14:20:00.000Z',
    summary: 'Studio, call',
    description: 'Line\nTwo',
    organizer: 'roger@algorithmacy.org',
    attendee: 'a@firm.test',
  });
  assert.match(file, /SUMMARY:Studio\\, call/);
  assert.match(file, /DTSTART:20260715T140000Z/);
  assert.match(file, /ATTENDEE/);
});

test('book validation rejects a bad email and accepts a discovery call', () => {
  const bad = validateBook({ name: 'A', email: 'nope', business: 'Firm', type: 'discovery', start: '2026-07-15T14:00:00.000Z' });
  assert.ok(bad.errors.length);
  const good = validateBook({
    name: 'Ada', email: 'ada@firm.test', business: 'Ada Law', type: 'discovery', start: '2026-07-15T14:00:00.000Z', note: 'Intake',
  });
  assert.equal(good.errors.length, 0);
  assert.equal(good.clean.email, 'ada@firm.test');
});

test('a flow keeps at most 12 clipped steps and an empty list clears it', () => {
  const lines = validateSteps('First step.\n\nSecond step.');
  assert.deepEqual(lines.clean, ['First step.', 'Second step.']);
  assert.equal(lines.errors.length, 0);
  const clipped = validateSteps(['x'.repeat(200)]);
  assert.equal(clipped.errors.length, 0);
  assert.equal(clipped.clean[0].length, 160);
  const tooMany = validateSteps(Array.from({ length: 13 }, (_, i) => 'Step number ' + (i + 1)));
  assert.match(tooMany.errors.join(' '), /12/);
  assert.deepEqual(tooMany.clean, []);
  assert.deepEqual(validateSteps('').clean, []);
  assert.deepEqual(validateSteps([]).clean, []);
  assert.ok(validateSteps('A').errors.length);
  assert.ok(validateSteps(3).errors.length);
  const agent = validateAgent({ name: 'Intake', chore: 'Reads inquiries.', steps: 'Draft the reply.\nAda sends it.' });
  assert.deepEqual(agent.clean.steps, ['Draft the reply.', 'Ada sends it.']);
  const event = validateEvent({ type: 'did', summary: 'Sent the reminder', agentId: 'intake' });
  assert.equal(event.clean.agentId, 'intake');
  assert.equal(validateEvent({ type: 'did', summary: 'Sent the reminder' }).clean.agentId, '');
});

test('event, account, and availability validation', () => {
  assert.ok(validateEvent({ type: 'nope', summary: 'hi' }).errors.length);
  assert.equal(validateEvent({ type: 'did', summary: 'Sent the reminder', detail: 'ok' }).errors.length, 0);
  assert.ok(validateAccountCreate({ office: 'A', kind: 'law firm', name: 'Ada', email: 'ada@firm.test' }).errors.length);
  const avail = validateAvailability({
    timeZone: 'America/New_York',
    bufferMin: 15,
    durations: { discovery: 20, checkpoint: 30, monthly: 30 },
    windows: [{ dow: 1, start: '10:00', end: '16:00' }],
    exceptions: [{ date: '2026-12-25', closed: true }],
  });
  assert.equal(avail.errors.length, 0);
  assert.equal(validateAvailability({ timeZone: 'Not/AZone', bufferMin: 15, durations: { discovery: 20, checkpoint: 30, monthly: 30 }, windows: [], exceptions: [] }).errors.length > 0, true);
});

test('the public calendar says it is not open without Firebase', async () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return;
  const book = require('../api/book');
  let body = '';
  const res = {
    statusCode: 0,
    writableEnded: false,
    setHeader() {},
    end(s) { body = s; this.writableEnded = true; },
  };
  await book({ method: 'GET', url: '/api/book?type=discovery', query: { type: 'discovery' }, headers: {} }, res);
  const json = JSON.parse(body);
  assert.equal(res.statusCode, 503);
  assert.match(json.error, /calendar is not open/);
});

test('a public booking with a bad email is rejected before any store call', async () => {
  const book = require('../api/book');
  let body = '';
  const res = {
    statusCode: 0,
    writableEnded: false,
    setHeader() {},
    end(s) { body = s; this.writableEnded = true; },
  };
  await book({
    method: 'POST',
    url: '/api/book',
    query: {},
    headers: {},
    body: { name: 'Ada', email: 'not-an-email', business: 'Ada Law', type: 'discovery', start: '2026-07-15T14:00:00.000Z' },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(body).error, /email/i);
});

test('the public config route answers without Firebase', async () => {
  const { dispatch } = require('../lib/portal/handlers');
  let body = '';
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { body = s; this.writableEnded = true; },
    writableEnded: false,
  };
  await dispatch({ method: 'GET', url: '/api/portal?path=config', query: { path: 'config' }, headers: {} }, res);
  const json = JSON.parse(body);
  assert.equal(res.statusCode, 200);
  assert.equal(json.configured, false);
  assert.equal(json.firebase, null);
});

test('client preview is read-only and only for the engineer', () => {
  const engineer = { isAdmin: true, email: 'roger@algorithmacy.org' };
  assert.deepEqual(previewAccess(engineer, 'GET', ''), { id: '', preview: false });
  assert.deepEqual(previewAccess(engineer, 'GET', ' acct '), { id: 'acct', preview: true });
  assert.throws(() => previewAccess({ isAdmin: false }, 'GET', 'acct'), { status: 403 });
  assert.throws(() => previewAccess(engineer, 'POST', 'acct'), { status: 403, message: 'Client preview is read-only.' });
});

test('an engineer invite names the photo file and Your Engineers', () => {
  assert.equal(slug('Lorraine Villaroel', 'lorraine@example.com'), 'lorraine-villaroel');
  assert.equal(slug('', 'andre@example.com'), 'andre');
  const text = engineerInviteText({
    name: 'Joseph',
    email: 'joseph@example.com',
    link: 'https://algorithmacy.org/portal/login/?email=joseph%40example.com',
  });
  assert.match(text, /Joseph/);
  assert.match(text, /joseph@example.com/);
  assert.match(text, /Your Engineers/);
  assert.doesNotMatch(text, /The engineer/);
  assert.match(text, /already on the Studio page/);
  assert.match(text, /authenticator/);
  assert.doesNotMatch(text, /sk_/);
});

test('route parts come from the query or the url', () => {
  assert.deepEqual(routeParts({ query: { path: 'meetings/slots' }, url: '/api/portal' }), ['meetings', 'slots']);
  assert.deepEqual(routeParts({ query: {}, url: '/api/portal/admin/accounts/abc?id=1' }), ['admin', 'accounts', 'abc']);
});
