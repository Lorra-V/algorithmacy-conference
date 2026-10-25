const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const store = require('../lib/portal/db');
const firebaseAdmin = require('../lib/portal/firebase-admin');
const mailer = require('../lib/portal/mail');
const portalAuth = require('../lib/portal/auth');
const applications = require('../lib/portal/engineer-applications');
const mfa = require('../lib/portal/mfa');
const { dispatch } = require('../lib/portal/handlers');
const { matchDirectoryEmail, matchDirectoryGithub } = require('../lib/portal/engineer-directory');

const JUSTIN = 'justin.raf.jimenez@gmail.com';
const JUSTIN_HASH = '1bd99dc8e3de';

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

function emailKeys(commands) {
  return commands
    .filter((command) => command[0] === 'INCR' || command[0] === 'DEL')
    .map((command) => command[1])
    .filter((key) => key.includes(':email:'));
}

test('the engineer directory agrees with the published page', () => {
  assert.equal(addressHash(JUSTIN), JUSTIN_HASH);
  const justin = matchDirectoryEmail('Justin.Raf.Jimenez@gmail.com');
  assert.equal(justin.name, 'Justin Jiménez');
  assert.equal(justin.github, 'jj-javascript');
  assert.equal(justin.published, true);
  assert.equal(matchDirectoryEmail('nobody@example.com'), null);
  const lorraine = matchDirectoryGithub('lorra-v');
  assert.equal(lorraine.name, 'Lorraine Villaroel');
  assert.equal(lorraine.github, 'Lorra-V');
  assert.equal(lorraine.email, 'lorraine@webblyweb.com');
  assert.equal(lorraine.published, true);
  const login = fs.readFileSync(path.join(__dirname, '../components/portal/LoginForm.jsx'), 'utf8');
  assert.match(login, /If you're a Studio engineer and don't get a link, sign in with GitHub or contact/);
  assert.match(login, /mailto:roger@algorithmacy\.org/);
});

test('a published engineer still has to enroll an authenticator', async () => {
  const previous = store.mfaRecord;
  store.mfaRecord = async () => null;
  try {
    const step = await mfa.gate({ uid: 'justin', email: JUSTIN }, { headers: {} });
    assert.equal(step, 'enroll');
  } finally {
    store.mfaRecord = previous;
  }
});

test('magic links follow the published engineer record and skip does not spend the email limit', async (t) => {
  const previousFirebase = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const previousAdmins = process.env.STUDIO_ADMIN_EMAILS;
  const previousRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const accountForEmail = store.accountForEmail;
  const invites = store.invites;
  const engineerInviteFor = store.engineerInviteFor;
  const engineerInviteForGithub = store.engineerInviteForGithub;
  const saveEngineerInvite = store.saveEngineerInvite;
  const attachEngineerEmail = store.attachEngineerEmail;
  const audit = store.audit;
  const auth = firebaseAdmin.auth;
  const sendMail = mailer.sendMail;
  const callerFromRequest = portalAuth.callerFromRequest;
  const githubAccount = applications.githubAccount;
  const originalFetch = global.fetch;
  const originalInfo = console.info;
  const logs = [];
  const commands = [];
  const mails = [];
  const saved = [];
  const attached = [];
  const links = [];
  const updates = [];

  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousFirebase || '{"project_id":"test"}';
  process.env.STUDIO_ADMIN_EMAILS = '';
  process.env.UPSTASH_REDIS_REST_URL = previousRedisUrl || 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = previousRedisToken || 'test-redis-token';
  console.info = (...args) => { logs.push(args); };
  store.accountForEmail = async () => null;
  store.invites = () => ({ where: () => ({ get: async () => ({ docs: [] }) }) });
  store.audit = async () => {};
  store.saveEngineerInvite = async (row) => {
    saved.push(row);
    return {
      id: 'eng-' + (row.github || 'mail'),
      name: row.name,
      email: row.email || '',
      github: row.github || '',
      pr: row.pr || 0,
      status: 'pending',
      profile: 'needed',
    };
  };
  store.attachEngineerEmail = async (invite, email) => {
    attached.push({ id: invite.id, email });
    return { ...invite, email };
  };
  firebaseAdmin.auth = () => ({
    generateSignInWithEmailLink: async (email, settings) => {
      links.push({ email, settings });
      return 'https://algorithmacy.org/portal/login/finish/?oobCode=test-code';
    },
    updateUser: async (uid, patch) => { updates.push({ uid, patch }); },
  });
  mailer.sendMail = async (message) => { mails.push(message); };
  global.fetch = async (_url, opts) => {
    const command = JSON.parse(opts.body);
    commands.push(command);
    return Response.json({ result: command[0] === 'DEL' ? 1 : 1 });
  };

  t.after(() => {
    store.accountForEmail = accountForEmail;
    store.invites = invites;
    store.engineerInviteFor = engineerInviteFor;
    store.engineerInviteForGithub = engineerInviteForGithub;
    store.saveEngineerInvite = saveEngineerInvite;
    store.attachEngineerEmail = attachEngineerEmail;
    store.audit = audit;
    firebaseAdmin.auth = auth;
    mailer.sendMail = sendMail;
    portalAuth.callerFromRequest = callerFromRequest;
    applications.githubAccount = githubAccount;
    global.fetch = originalFetch;
    console.info = originalInfo;
    if (previousFirebase === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousFirebase;
    if (previousAdmins === undefined) delete process.env.STUDIO_ADMIN_EMAILS;
    else process.env.STUDIO_ADMIN_EMAILS = previousAdmins;
    if (previousRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousRedisUrl;
    if (previousRedisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousRedisToken;
  });

  async function post(path, body, ip) {
    const res = mockRes();
    await dispatch({
      method: 'POST',
      url: '/api/portal?path=' + path,
      query: { path },
      headers: {
        ...(ip ? { 'x-forwarded-for': ip } : {}),
        authorization: 'Bearer test-token',
      },
      body,
    }, res);
    return res;
  }

  store.engineerInviteFor = async () => null;
  const beforeJustin = commands.length;
  const justin = await post('auth/link', { email: 'Justin.Raf.Jimenez@gmail.com' }, '203.0.113.20');
  assert.equal(justin.statusCode, 200);
  assert.deepEqual(justin.json(), { ok: true });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].email, JUSTIN);
  assert.equal(saved[0].github, 'jj-javascript');
  assert.equal(saved[0].name, 'Justin Jiménez');
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, JUSTIN);
  assert.match(mails[0].text, /oobCode=test-code/);
  assert.equal(links[0].email, JUSTIN);
  assert.match(links[0].settings.url, /\/portal\/login\/finish\/$/);
  const justinLogs = logs.filter((entry) => entry[1] && entry[1].address === JUSTIN_HASH);
  assert.deepEqual(justinLogs.map((entry) => entry[0]), ['signin link sent']);
  assert.equal(logs.some((entry) => entry[0] === 'signin email rate released'), false);
  assert.equal(logs.some((entry) => entry[0] === 'signin link skipped'), false);
  const justinHash = crypto.createHash('sha256').update(JUSTIN).digest('hex');
  const justinKeys = emailKeys(commands.slice(beforeJustin));
  assert.deepEqual(justinKeys, [
    'acf:rate:studio:login:email:' + justinHash,
  ]);
  assert.equal(commands.slice(beforeJustin).some((command) => command[0] === 'DEL' && String(command[1]).startsWith('acf:rate:email:')), false);
  assert.equal(JSON.stringify(logs).includes(JUSTIN), false);

  saved.length = 0;
  mails.length = 0;
  store.engineerInviteFor = async () => ({ id: 'eng-justin', name: 'Justin Jimenez', email: JUSTIN, status: 'pending' });
  const accent = await post('auth/link', { email: JUSTIN }, '203.0.113.21');
  assert.equal(accent.statusCode, 200);
  assert.equal(saved.length, 0);
  assert.equal(mails.length, 1);
  assert.equal(logs.some((entry) => entry[0] === 'signin link skipped' && entry[1].address === JUSTIN_HASH), false);

  mails.length = 0;
  const beforeSkip = commands.length;
  store.engineerInviteFor = async () => ({ name: 'Ada Missing', email: 'ada.missing@example.com' });
  const unpublished = await post('auth/link', { email: 'ada.missing@example.com' }, '203.0.113.10');
  assert.equal(unpublished.statusCode, 200);
  assert.deepEqual(unpublished.json(), { ok: true });
  assert.equal(mails.length, 0);
  assert.deepEqual(logs.at(-1), [
    'signin link skipped',
    { address: addressHash('ada.missing@example.com'), reason: 'engineer profile is not published' },
  ]);
  assert.deepEqual(emailKeys(commands.slice(beforeSkip)), []);

  const beforeUnknown = commands.length;
  store.engineerInviteFor = async () => null;
  const unknown = await post('auth/link', { email: 'nobody@example.com' }, '203.0.113.11');
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(unknown.json(), { ok: true });
  assert.deepEqual(logs.at(-1), [
    'signin link skipped',
    { address: addressHash('nobody@example.com'), reason: 'no account, pending invite, or admin role' },
  ]);
  assert.deepEqual(emailKeys(commands.slice(beforeUnknown)), []);
  assert.equal(commands.slice(beforeUnknown).some((command) => String(command[1]).includes('studio:login')), true);

  const honeypot = await post('auth/link', { email: JUSTIN, website: 'https://spam.example' });
  assert.equal(honeypot.statusCode, 200);
  assert.deepEqual(honeypot.json(), { ok: true });
  assert.deepEqual(logs.at(-1), [
    'signin link skipped',
    { address: JUSTIN_HASH, reason: 'honeypot' },
  ]);
  assert.equal(JSON.stringify(logs).includes('nobody@example.com'), false);
  assert.equal(JSON.stringify(logs).includes('ada.missing@example.com'), false);

  mailer.sendMail = async () => { throw Object.assign(new Error('mailgun down'), { status: 503 }); };
  store.engineerInviteFor = async () => ({ id: 'eng-justin', name: 'Justin Jiménez', email: JUSTIN, status: 'pending' });
  const beforeFail = commands.length;
  const failed = await post('auth/link', { email: JUSTIN }, '203.0.113.40');
  assert.equal(failed.statusCode, 503);
  const failCommands = commands.slice(beforeFail).filter((command) => (
    (command[0] === 'INCR' || command[0] === 'DECR' || command[0] === 'DEL') && String(command[1]).includes(':email:')
  ));
  assert.deepEqual(failCommands.map((command) => command[0]), ['INCR', 'DECR']);
  assert.equal(failCommands.every((command) => String(command[1]).includes('studio:login:email:')), true);
  assert.equal(failCommands.some((command) => String(command[1]).startsWith('acf:rate:email:')), false);
  mailer.sendMail = async (message) => { mails.push(message); };

  saved.length = 0;
  mails.length = 0;
  store.engineerInviteFor = async () => ({ id: 'eng-justin', name: 'Justin Jiménez', email: JUSTIN, status: 'revoked' });
  const revoked = await post('auth/link', { email: JUSTIN }, '203.0.113.41');
  assert.equal(revoked.statusCode, 200);
  assert.deepEqual(revoked.json(), { ok: true });
  assert.equal(saved.length, 0);
  assert.equal(mails.length, 0);
  assert.deepEqual(logs.at(-1), [
    'signin link skipped',
    { address: JUSTIN_HASH, reason: 'no account, pending invite, or admin role' },
  ]);

  saved.length = 0;
  attached.length = 0;
  store.engineerInviteForGithub = async () => null;
  portalAuth.callerFromRequest = async () => ({
    uid: 'lorraine',
    email: 'lorraine.real@example.com',
    name: 'Lorraine Villaroel',
    isAdmin: false,
  });
  applications.githubAccount = async () => ({ login: 'Lorra-V', email: 'lorraine.real@example.com' });
  const github = await post('auth/github', { token: 'gho_test' }, '203.0.113.30');
  assert.equal(github.statusCode, 200);
  assert.deepEqual(github.json(), { ok: true, email: 'lorraine.real@example.com' });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Lorraine Villaroel');
  assert.equal(saved[0].github, 'Lorra-V');
  assert.equal(saved[0].email, 'lorraine@webblyweb.com');
  assert.deepEqual(attached, [{ id: 'eng-Lorra-V', email: 'lorraine.real@example.com' }]);

  portalAuth.callerFromRequest = async () => ({
    uid: 'lorraine',
    email: 'lorra-v@users.noreply.github.com',
    name: 'Lorraine Villaroel',
    isAdmin: false,
  });
  const noreply = await post('auth/github', { token: 'gho_test' }, '203.0.113.31');
  assert.equal(noreply.statusCode, 200);
  assert.deepEqual(noreply.json(), { ok: true, email: 'lorraine.real@example.com', refresh: true });
  assert.deepEqual(updates, [{
    uid: 'lorraine',
    patch: { email: 'lorraine.real@example.com', emailVerified: true },
  }]);
  assert.equal(attached.at(-1).email, 'lorraine.real@example.com');

  applications.githubAccount = async () => ({ login: 'Lorra-V', email: '' });
  updates.length = 0;
  const attachedBefore = attached.length;
  const stillNoreply = await post('auth/github', { token: 'gho_test' }, '203.0.113.33');
  assert.equal(stillNoreply.statusCode, 400);
  assert.match(stillNoreply.json().error, /did not share an email address/);
  assert.equal(updates.length, 0);
  assert.equal(attached.length, attachedBefore);

  saved.length = 0;
  store.engineerInviteForGithub = async () => ({
    id: 'eng-Lorra-V',
    name: 'Lorraine Villaroel',
    email: '',
    github: 'Lorra-V',
    status: 'revoked',
  });
  applications.githubAccount = async () => ({ login: 'Lorra-V', email: 'lorraine.real@example.com' });
  const blocked = await post('auth/github', { token: 'gho_test' }, '203.0.113.32');
  assert.equal(blocked.statusCode, 403);
  assert.equal(JSON.stringify(blocked.json()).toLowerCase().includes('revoked'), false);
  assert.equal(saved.length, 0);
});

test('audit retention keeps 400 days', () => {
  const { auditCutoff } = require('../lib/portal/db');
  const now = new Date('2026-10-16T12:00:00.000Z');
  const cutoff = new Date(auditCutoff(now));
  assert.equal(now.getTime() - cutoff.getTime(), 400 * 24 * 60 * 60 * 1000);
});
