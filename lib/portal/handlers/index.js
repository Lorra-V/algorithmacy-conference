const { auth, configured } = require('../firebase-admin');
const { callerFromRequest } = require('../auth');
const store = require('../db');
const booking = require('../booking');
const billing = require('../billing');
const { sendMail } = require('../mail');
const { send, fail, readJson, siteUrl, escapeHtml, routeParts, queryValue, clientIp } = require('../http');
const {
  clip, validateEmail, validateAccountCreate, validateInvite, validateAgent, validateAvailability, validateRequest,
} = require('../validate');
const core = require('../../submission-core');
const { previewAccess } = require('../preview');
const { engineerTask, engineerInviteText } = require('../engineer');
const { validChallenge, safeRedirectUri } = require('../oauth');
const mfa = require('../mfa');

const ROGER = 'roger@algorithmacy.org';

async function requireUser(req) {
  const user = await callerFromRequest(req);
  if (!user) throw fail(401, 'Sign in required.');
  const step = await mfa.gate(user, req);
  if (step !== 'ok') {
    const err = fail(403, step === 'enroll'
      ? 'Set up an authenticator before opening the portal.'
      : 'Enter the code from your authenticator.');
    err.mfa = step;
    throw err;
  }
  user.mfa = 'ok';
  return user;
}

async function ensureEngineer(user) {
  const invite = await store.engineerInviteFor(user.email);
  if (!invite) return user;
  if (!user.name && invite.name) user.name = invite.name;
  if (invite.status !== 'claimed') {
    await store.claimEngineer(user);
    try {
      const record = await auth().getUser(user.uid);
      const claims = Object.assign({}, record.customClaims, { studioAdmin: true });
      await auth().setCustomUserClaims(user.uid, claims);
    } catch (e) {
      console.error('studio engineer claim', e);
    }
  }
  user.isAdmin = true;
  user.engineerProfile = invite.profile || 'needed';
  return user;
}

async function requireAdmin(req) {
  const user = await ensureEngineer(await requireUser(req));
  if (!user.isAdmin) throw fail(403, 'This page is for the engineer.');
  return user;
}

function webConfig() {
  let parsed = null;
  try { parsed = JSON.parse(process.env.FIREBASE_WEB_CONFIG || ''); }
  catch { parsed = null; }
  const allow = ['apiKey', 'authDomain', 'projectId', 'appId', 'measurementId', 'storageBucket', 'messagingSenderId'];
  const firebase = {};
  if (parsed && typeof parsed === 'object') {
    for (const key of allow) if (parsed[key]) firebase[key] = parsed[key];
  }
  const ready = Boolean(firebase.apiKey && firebase.authDomain && firebase.projectId && firebase.appId);
  return { configured: ready, firebase: ready ? firebase : null };
}

async function sendLink(req, res) {
  const body = await readJson(req);
  if (body.website) return send(res, 200, { ok: true });
  const email = validateEmail(body.email);
  if (!email) throw fail(400, 'A valid email is required.');
  if (!configured()) throw fail(503, 'Sign-in is not configured.');
  await core.enforceRate({
    email,
    ip: clientIp(req),
    bucket: 'studio:login',
    message: 'Too many attempts. Please try again in an hour.',
  });
  const account = await store.accountForEmail(email);
  const inviteSnap = await store.invites().where('email', '==', email).get();
  const pending = inviteSnap.docs.some((d) => d.data().status !== 'claimed');
  const engineer = await store.engineerInviteFor(email);
  if (!account && !pending && !engineer) return send(res, 200, { ok: true });
  const link = await auth().generateSignInWithEmailLink(email, {
    url: siteUrl() + '/portal/login/finish/',
    handleCodeInApp: true,
  });
  await sendMail({
    to: email,
    replyTo: ROGER,
    subject: 'Sign in to Algorithmacy Studio',
    text: 'Sign in to your Studio account. This link works once, and it expires.\n\n' + link + '\n\nIf you did not ask for this, ignore it.',
    html: `<p>Sign in to your Studio account. This link works once, and it expires.</p><p><a href="${escapeHtml(link)}">Sign in</a></p><p>If you did not ask for this, ignore it.</p>`,
  });
  await store.audit({ action: 'signin.link', email });
  return send(res, 200, { ok: true });
}

async function accountForCaller(user, req) {
  const access = previewAccess(user, req.method, queryValue(req, 'as'));
  if (!access.preview) return store.requireAccount(user);
  const acc = await store.accountById(access.id);
  if (!acc) throw fail(404, 'That account is not here.');
  return Object.assign({}, acc, { role: 'owner', preview: true });
}

async function me(req, res) {
  const identified = await callerFromRequest(req);
  if (!identified) throw fail(401, 'Sign in required.');
  const user = await ensureEngineer(identified);
  const step = await mfa.gate(user, req);
  if (step !== 'ok') {
    return send(res, 200, {
      mfa: step,
      user: { email: user.email, name: user.name, isAdmin: user.isAdmin },
      account: null,
    });
  }
  await store.claimInvites(user);
  const access = previewAccess(user, 'GET', queryValue(req, 'as'));
  let account = null;
  if (access.preview) {
    const acc = await store.accountById(access.id);
    if (!acc) throw fail(404, 'That account is not here.');
    account = store.clientAccount(Object.assign({}, acc, { role: 'owner' }));
    account.preview = true;
  } else {
    const own = await store.accountForEmail(user.email);
    account = own ? store.clientAccount(own) : null;
  }
  const profile = user.engineerProfile || '';
  return send(res, 200, {
    mfa: 'ok',
    user: {
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
      engineerProfile: profile,
      engineerTask: profile === 'needed' ? engineerTask(user.name, user.email) : null,
    },
    account: account,
  });
}

async function mfaRoute(req, res, path) {
  const user = await callerFromRequest(req);
  if (!user) throw fail(401, 'Sign in required.');
  const body = await readJson(req);
  if (path === 'mfa/enroll') return send(res, 200, await mfa.enroll(user));
  if (path === 'mfa/confirm') return send(res, 200, await mfa.confirm(user, body.code));
  return send(res, 200, await mfa.verify(user, body.code));
}

async function home(req, res) {
  const user = await requireUser(req);
  await store.claimInvites(user);
  const account = await accountForCaller(user, req);
  const [agents, activity, approvals, requests, meetings] = await Promise.all([
    store.listAgents(account.id),
    store.listActivity(account.id, { limit: 8 }),
    store.listApprovals(account.id, 'pending'),
    store.listRequests(account.id),
    booking.listAccountMeetings(account.id),
  ]);
  const now = Date.now();
  const upcoming = meetings.find((m) => m.status === 'booked' && new Date(m.start).getTime() > now) || null;
  return send(res, 200, {
    account: store.clientAccount(account),
    agents,
    activity,
    approvals,
    requests: requests.filter((r) => r.status === 'open'),
    upcoming,
  });
}

async function invite(req, res, user) {
  const account = await accountForCaller(user, req);
  if (account.role !== 'owner' && !user.isAdmin) throw fail(403, 'An owner sends invites.');
  const body = await readJson(req);
  const { errors, clean } = validateInvite(body);
  if (errors.length) throw fail(400, errors[0]);
  await store.inviteMember(account, clean);
  const link = siteUrl() + '/portal/login/?email=' + encodeURIComponent(clean.email);
  try {
    await sendMail({
      to: clean.email,
      replyTo: ROGER,
      subject: 'You are invited to ' + account.office + ' on Algorithmacy Studio',
      text: account.office + ' invited you to the Studio portal.\n\nSign in: ' + link,
      html: `<p>${escapeHtml(account.office)} invited you to the Studio portal.</p><p><a href="${escapeHtml(link)}">Sign in</a></p>`,
    });
  } catch (e) {
    console.error('studio invite email', e);
  }
  return send(res, 200, { ok: true });
}

async function oauthConsent(req, res, user) {
  if (queryValue(req, 'as')) throw fail(403, 'Open your own sign-in to connect an assistant. A preview cannot.');
  const person = await ensureEngineer(user);
  const body = await readJson(req);
  const client = await store.oauthClient(body.client_id);
  if (!client || !Array.isArray(client.redirectUris)) throw fail(400, 'This application is not registered.');
  const redirectUri = String(body.redirect_uri || '');
  if (!safeRedirectUri(redirectUri) || !client.redirectUris.includes(redirectUri)) {
    throw fail(400, 'That redirect is not registered.');
  }
  const state = typeof body.state === 'string' ? body.state.slice(0, 512) : '';
  if (body.role === 'deny') {
    const denied = new URL(redirectUri);
    denied.searchParams.set('error', 'access_denied');
    if (state) denied.searchParams.set('state', state);
    return send(res, 200, { redirect: denied.toString() });
  }
  const method = body.code_challenge_method || 'S256';
  if (method !== 'S256' || !validChallenge(body.code_challenge)) throw fail(400, 'PKCE S256 is required.');
  const want = body.role === 'engineer' ? 'engineer' : 'client';
  let accountId = '';
  if (want === 'engineer') {
    if (!person.isAdmin) throw fail(403, 'This sign-in is not an engineer.');
  } else {
    const account = await store.requireAccount(person);
    accountId = account.id;
  }
  const code = await store.issueOauthCode({
    clientId: body.client_id,
    redirectUri,
    codeChallenge: String(body.code_challenge),
    email: person.email,
    name: person.name || '',
    role: want,
    accountId,
  });
  await store.audit({ action: 'oauth.consent', email: person.email, detail: client.clientName || '' });
  const next = new URL(redirectUri);
  next.searchParams.set('code', code);
  if (state) next.searchParams.set('state', state);
  return send(res, 200, { redirect: next.toString() });
}

async function handle(req, res) {
  const parts = routeParts(req);
  const method = req.method || 'GET';
  const path = parts.join('/');

  if (method === 'GET' && path === 'config') return send(res, 200, webConfig());
  if (method === 'POST' && path === 'auth/link') return sendLink(req, res);
  if (method === 'POST' && path === 'connector') {
    throw fail(410, 'Connect an assistant from Claude, Cursor, or Grok. There is no key to copy.');
  }
  if (method === 'POST' && (path === 'mfa/enroll' || path === 'mfa/confirm' || path === 'mfa/verify')) {
    return mfaRoute(req, res, path);
  }
  if (method === 'GET' && path === 'me') return me(req, res);
  if (method === 'GET' && path === 'home') return home(req, res);

  if (path.startsWith('admin/') || path === 'admin') {
    const admin = await requireAdmin(req);
    return adminRoute(req, res, admin, method, parts);
  }

  const user = await requireUser(req);

  if (method === 'GET' && path === 'oauth/client') {
    const client = await store.oauthClient(queryValue(req, 'client_id'));
    const redirectUri = queryValue(req, 'redirect_uri');
    if (!client || !Array.isArray(client.redirectUris) || !safeRedirectUri(redirectUri) || !client.redirectUris.includes(redirectUri)) {
      throw fail(400, 'This application is not registered.');
    }
    return send(res, 200, { clientName: client.clientName, redirectUri });
  }
  if (method === 'POST' && path === 'oauth/consent') return oauthConsent(req, res, user);
  if (method === 'GET' && path === 'account') {
    await store.claimInvites(user);
    const account = await accountForCaller(user, req);
    return send(res, 200, { account: store.clientAccount(account) });
  }
  if (method === 'POST' && path === 'members') return invite(req, res, user);
  if (method === 'POST' && path === 'members/remove') {
    const account = await accountForCaller(user, req);
    if (account.role !== 'owner') throw fail(403, 'An owner removes people.');
    const body = await readJson(req);
    const email = validateEmail(body.email);
    if (!email) throw fail(400, 'A valid email is required.');
    await store.removeMember(account, email);
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && path === 'members/digest') {
    const account = await accountForCaller(user, req);
    const body = await readJson(req);
    await store.setDigest(account, user.email, Boolean(body.digest));
    return send(res, 200, { ok: true });
  }
  if (method === 'GET' && path === 'agents') {
    const account = await accountForCaller(user, req);
    return send(res, 200, { agents: await store.listAgents(account.id) });
  }
  if (method === 'GET' && path === 'activity') {
    const account = await accountForCaller(user, req);
    return send(res, 200, {
      activity: await store.listActivity(account.id, {
        type: queryValue(req, 'type'),
        agentId: queryValue(req, 'agent'),
      }),
      agents: await store.listAgents(account.id),
    });
  }
  if (method === 'GET' && path === 'approvals') {
    const account = await accountForCaller(user, req);
    return send(res, 200, { approvals: await store.listApprovals(account.id, queryValue(req, 'status') || 'pending') });
  }
  if (method === 'POST' && path === 'approvals') {
    const account = await accountForCaller(user, req);
    const body = await readJson(req);
    const result = await store.decideApproval(account.id, clip(body.id, 80), body.decision, user.email);
    return send(res, 200, { approval: result });
  }
  if (method === 'GET' && path === 'requests') {
    const account = await accountForCaller(user, req);
    return send(res, 200, { requests: await store.listRequests(account.id) });
  }
  if (method === 'POST' && path === 'requests') {
    const account = await accountForCaller(user, req);
    const body = await readJson(req);
    const { errors, clean } = validateRequest(body);
    if (errors.length) throw fail(400, errors[0]);
    return send(res, 200, { request: await store.addRequest(account.id, { ...clean, email: user.email }) });
  }
  if (method === 'GET' && path === 'meetings') {
    const account = await accountForCaller(user, req);
    return send(res, 200, { meetings: await booking.listAccountMeetings(account.id) });
  }
  if (method === 'GET' && path === 'meetings/slots') {
    const account = await accountForCaller(user, req);
    if (account.status === 'cancelled') throw fail(403, 'This engagement has ended.');
    const type = queryValue(req, 'type') === 'monthly' ? 'monthly' : 'checkpoint';
    return send(res, 200, await booking.openSlots(type));
  }
  if (method === 'POST' && path === 'meetings/hold') {
    const account = await accountForCaller(user, req);
    const body = await readJson(req);
    const type = body.type === 'monthly' ? 'monthly' : 'checkpoint';
    return send(res, 200, await booking.holdSlot({ type, start: body.start }));
  }
  if (method === 'POST' && path === 'meetings') {
    const account = await accountForCaller(user, req);
    if (account.status === 'cancelled') throw fail(403, 'This engagement has ended.');
    const body = await readJson(req);
    const type = body.type === 'monthly' ? 'monthly' : (body.type === 'checkpoint' ? 'checkpoint' : '');
    if (!type) throw fail(400, 'Choose a checkpoint or a monthly call.');
    const meeting = await booking.createMeeting({
      type,
      start: body.start,
      name: user.name || user.email,
      email: user.email,
      business: account.office,
      note: clip(body.note || '', 400),
      accountId: account.id,
      holdToken: clip(body.holdToken || '', 80),
    });
    return send(res, 200, { meeting });
  }
  if (method === 'POST' && path === 'meetings/cancel') {
    const account = await accountForCaller(user, req);
    const body = await readJson(req);
    const meeting = await booking.meetingByToken(body.id);
    if (meeting.accountId !== account.id && meeting.email !== user.email) {
      throw fail(403, 'That call is not on this account.');
    }
    return send(res, 200, { meeting: await booking.cancelMeeting(meeting) });
  }
  if (method === 'GET' && path === 'reports') {
    const account = await accountForCaller(user, req);
    return send(res, 200, { reports: await store.listReports(account.id) });
  }
  if (method === 'POST' && path === 'billing/checkout') {
    const account = await accountForCaller(user, req);
    if (account.role !== 'owner' && !user.isAdmin) throw fail(403, 'An owner pays.');
    return send(res, 200, await billing.checkout(account, user.email));
  }
  if (method === 'POST' && path === 'billing/portal') {
    const account = await accountForCaller(user, req);
    if (account.role !== 'owner' && !user.isAdmin) throw fail(403, 'An owner manages billing.');
    return send(res, 200, await billing.portal(account));
  }

  throw fail(404, 'Not found.');
}

async function adminRoute(req, res, admin, method, parts) {
  const path = parts.join('/');
  if (method === 'GET' && path === 'admin/accounts' && !parts[2]) {
    const id = queryValue(req, 'id');
    if (id) return send(res, 200, await adminAccount(id));
    return send(res, 200, {
      accounts: await store.listAccounts(),
      leads: await store.listLeads(),
      engineers: await store.listEngineers(),
    });
  }
  if (method === 'GET' && parts[0] === 'admin' && parts[1] === 'accounts' && parts[2]) {
    return send(res, 200, await adminAccount(parts[2]));
  }
  if (method === 'POST' && path === 'admin/accounts') {
    const body = await readJson(req);
    const { errors, clean } = validateAccountCreate(body);
    if (errors.length) throw fail(400, errors[0]);
    const account = await store.createAccount(clean);
    const link = siteUrl() + '/portal/login/?email=' + encodeURIComponent(clean.email);
    try {
      await sendMail({
        to: clean.email,
        replyTo: ROGER,
        subject: 'Your Algorithmacy Studio account',
        text: 'An account is open for ' + clean.office + '.\n\nSign in: ' + link + '\n\nNothing is connected until the access is agreed.',
        html: `<p>An account is open for ${escapeHtml(clean.office)}.</p><p><a href="${escapeHtml(link)}">Sign in</a></p>`,
      });
    } catch (e) {
      console.error('studio account email', e);
    }
    return send(res, 200, { account: { id: account.id, office: account.office } });
  }
  if (method === 'POST' && path === 'admin/mfa/reset') {
    const body = await readJson(req);
    const email = validateEmail(body.email);
    if (!email) throw fail(400, 'A valid email is required.');
    await store.deleteMfaForEmail(email);
    await store.revokeAssistantAccess(email);
    await store.audit({ action: 'mfa.reset', email, detail: admin.email });
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && path === 'admin/engineers') {
    const body = await readJson(req);
    const { errors, clean } = validateInvite(body);
    if (errors.length) throw fail(400, errors[0]);
    if (clean.name.length < 2) throw fail(400, 'A name is required.');
    const row = await store.saveEngineerInvite(clean);
    const link = siteUrl() + '/portal/login/?email=' + encodeURIComponent(clean.email);
    const text = engineerInviteText({ name: clean.name, email: clean.email, link });
    try {
      await sendMail({
        to: clean.email,
        replyTo: ROGER,
        subject: 'You are invited to Algorithmacy Studio as an engineer',
        text,
        html: '<p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>',
      });
    } catch (e) {
      console.error('studio engineer invite', e);
    }
    return send(res, 200, { engineer: row });
  }
  if (method === 'POST' && path === 'admin/engineers/profile') {
    await store.setEngineerProfile(admin.email);
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && path === 'admin/agents/key') {
    const body = await readJson(req);
    const account = await store.accountById(clip(body.accountId, 80));
    if (!account) throw fail(404, 'That account is not here.');
    const apiKey = await store.revealAgentKey(account.id, clip(body.agentId, 80));
    if (!apiKey) throw fail(404, 'That key is no longer waiting.');
    return send(res, 200, { apiKey });
  }
  if (method === 'POST' && path === 'admin/agents') {
    const body = await readJson(req);
    const account = await store.accountById(clip(body.accountId, 80));
    if (!account) throw fail(404, 'That account is not here.');
    const { errors, clean } = validateAgent(body);
    if (errors.length) throw fail(400, errors[0]);
    const agent = await store.createAgent(account.id, clean);
    const apiKey = await store.revealAgentKey(account.id, agent.id);
    if (!apiKey) throw fail(503, 'The agent key could not be shown. Create it again.');
    return send(res, 200, { agent: { ...agent, apiKey, keyWaiting: false } });
  }
  if (method === 'POST' && path === 'admin/agents/status') {
    const body = await readJson(req);
    await store.setAgentStatus(clip(body.accountId, 80), clip(body.agentId, 80), body.status);
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && path === 'admin/notes') {
    const body = await readJson(req);
    const accountId = clip(body.accountId, 80);
    const summary = clip(body.summary, 500);
    if (summary.length < 2) throw fail(400, 'Write the note.');
    const activity = await store.addActivity(accountId, {
      type: 'note',
      summary,
      detail: typeof body.detail === 'string' ? body.detail.slice(0, 4000) : '',
      agentId: clip(body.agentId || '', 80),
    });
    return send(res, 200, { activity });
  }
  if (method === 'GET' && path === 'admin/leads') {
    return send(res, 200, { leads: await store.listLeads() });
  }
  if (method === 'GET' && path === 'admin/availability') {
    const { loadAvailability } = booking;
    return send(res, 200, { availability: await loadAvailability() });
  }
  if (method === 'PUT' && path === 'admin/availability') {
    const body = await readJson(req);
    const { errors, clean } = validateAvailability(body);
    if (errors.length) throw fail(400, errors[0]);
    return send(res, 200, { availability: await store.saveAvailability(clean) });
  }
  if (method === 'POST' && path === 'admin/approvals') {
    const body = await readJson(req);
    const result = await store.decideApproval(clip(body.accountId, 80), clip(body.id, 80), body.decision, admin.email);
    return send(res, 200, { approval: result });
  }
  if (method === 'POST' && path === 'admin/requests') {
    const body = await readJson(req);
    await store.closeRequest(clip(body.accountId, 80), clip(body.id, 80));
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && path === 'admin/reports') {
    const body = await readJson(req);
    const account = await store.accountById(clip(body.accountId, 80));
    if (!account) throw fail(404, 'That account is not here.');
    const { previousMonth, writeReport } = require('../jobs');
    const avail = await booking.loadAvailability();
    const month = previousMonth(new Date(), avail.timeZone);
    const report = await writeReport(account, month);
    return send(res, 200, { report });
  }
  if (method === 'POST' && path === 'admin/reply') {
    const body = await readJson(req);
    const replyTime = clip(body.replyTime, 160);
    await store.setReplyTime(clip(body.accountId, 80), replyTime);
    return send(res, 200, { ok: true });
  }
  throw fail(404, 'Not found.');
}

async function adminAccount(id) {
  const account = await store.accountById(id);
  if (!account) throw fail(404, 'That account is not here.');
  const [agents, activity, approvals, requests, meetings, reports] = await Promise.all([
    store.listAgents(id),
    store.listActivity(id, { limit: 30 }),
    store.listApprovals(id),
    store.listRequests(id),
    booking.listAccountMeetings(id),
    store.listReports(id),
  ]);
  return { account, agents, activity, approvals, requests, meetings, reports };
}

async function dispatch(req, res) {
  try {
    await handle(req, res);
  } catch (e) {
    const status = e.status || (e instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error('studio portal', e);
    if (res.writableEnded) return;
    const body = { error: status >= 500 ? 'Something went wrong. Try again, or write to roger@algorithmacy.org.' : e.message };
    if (e.mfa) body.mfa = e.mfa;
    send(res, status, body);
  }
}

module.exports = { dispatch, webConfig };
