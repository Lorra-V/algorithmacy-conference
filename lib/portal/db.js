const crypto = require('node:crypto');
const { db } = require('./firebase-admin');
const { fail } = require('./http');

const ACCOUNTS = 'studio_accounts';
const AGENTS = 'studio_agents';
const ACTIVITY = 'studio_activity';
const APPROVALS = 'studio_approvals';
const REQUESTS = 'studio_requests';

function accounts() { return db().collection(ACCOUNTS); }
function meetings() { return db().collection('studio_meetings'); }
function invites() { return db().collection('studio_invites'); }
function engineers() { return db().collection('studio_engineers'); }
function leads() { return db().collection('studio_leads'); }
function reports() { return db().collection('studio_reports'); }
function keys() { return db().collection('studio_agent_keys'); }
function connectors() { return db().collection('studio_connector_keys'); }
function oauthClients() { return db().collection('studio_oauth_clients'); }
function oauthCodes() { return db().collection('studio_oauth_codes'); }
function oauthGrants() { return db().collection('studio_oauth_grants'); }
function locks() { return db().collection('studio_slot_locks'); }
function jobs() { return db().collection('studio_jobs'); }
function stripeEvents() { return db().collection('studio_stripe_events'); }
function mfaDocs() { return db().collection('studio_mfa'); }

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function docData(snap) {
  if (!snap || !snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

function clientAccount(acc) {
  return {
    id: acc.id,
    office: acc.office,
    kind: acc.kind,
    status: acc.status,
    billingStatus: acc.billingStatus || 'none',
    replyTime: acc.replyTime || '',
    role: acc.role || 'member',
    members: (acc.members || []).map((m) => ({
      email: m.email,
      name: m.name || '',
      role: m.role,
      digest: m.digest !== false,
    })),
  };
}

async function accountById(id) {
  return docData(await accounts().doc(id).get());
}

async function accountForEmail(email) {
  const snap = await accounts().where('memberEmails', 'array-contains', email).limit(1).get();
  if (snap.empty) return null;
  const acc = { id: snap.docs[0].id, ...snap.docs[0].data() };
  const member = (acc.members || []).find((m) => m.email === email);
  acc.role = member ? member.role : 'member';
  return acc;
}

async function requireAccount(user) {
  const acc = await accountForEmail(user.email);
  if (!acc) throw fail(403, 'No account for this address yet. Book a call.');
  return acc;
}

async function claimInvites(user) {
  const snap = await invites().where('email', '==', user.email).get();
  for (const doc of snap.docs) {
    const inv = doc.data();
    if (inv.status === 'claimed') continue;
    const ref = accounts().doc(inv.accountId);
    await db().runTransaction(async (tx) => {
      const accSnap = await tx.get(ref);
      if (!accSnap.exists) return;
      const data = accSnap.data();
      const members = Array.isArray(data.members) ? data.members.slice() : [];
      const existing = members.find((m) => m.email === user.email);
      if (existing) {
        existing.uid = user.uid;
        if (user.name) existing.name = user.name;
      } else {
        members.push({
          uid: user.uid,
          email: user.email,
          name: user.name || inv.name || '',
          role: inv.role || 'member',
          digest: true,
        });
      }
      const memberUids = [...new Set([...(data.memberUids || []), user.uid])];
      const memberEmails = [...new Set([...(data.memberEmails || []), user.email])];
      const patch = { members, memberUids, memberEmails };
      if ((inv.role === 'owner' || existing && existing.role === 'owner') && !data.ownerUid) {
        patch.ownerUid = user.uid;
      }
      tx.update(ref, patch);
      tx.update(doc.ref, {
        status: 'claimed',
        uid: user.uid,
        claimedAt: new Date().toISOString(),
      });
    });
  }
}

async function createAccount({ office, kind, name, email }) {
  const existing = await accountForEmail(email);
  if (existing) throw fail(409, 'That address already has an account.');
  const ref = accounts().doc();
  const now = new Date().toISOString();
  await ref.set({
    office,
    kind,
    status: 'invited',
    ownerUid: '',
    memberUids: [],
    memberEmails: [email],
    members: [{ uid: '', email, name, role: 'owner', digest: true }],
    stripeCustomerId: '',
    stripeSubscriptionId: '',
    billingStatus: 'none',
    replyTime: '',
    createdAt: now,
  });
  await invites().add({
    email,
    accountId: ref.id,
    role: 'owner',
    name,
    status: 'pending',
    createdAt: now,
  });
  return accountById(ref.id);
}

async function inviteMember(account, { email, name }) {
  if ((account.members || []).some((m) => m.email === email)) {
    throw fail(409, 'That person is already on the account.');
  }
  const now = new Date().toISOString();
  const members = (account.members || []).concat([{
    uid: '', email, name: name || '', role: 'member', digest: true,
  }]);
  const memberEmails = [...new Set([...(account.memberEmails || []), email])];
  await accounts().doc(account.id).update({ members, memberEmails });
  await invites().add({
    email,
    accountId: account.id,
    role: 'member',
    name: name || '',
    status: 'pending',
    createdAt: now,
  });
}

async function removeMember(account, email) {
  const member = (account.members || []).find((m) => m.email === email);
  if (!member) throw fail(404, 'That person is not on the account.');
  const owners = (account.members || []).filter((m) => m.role === 'owner');
  if (member.role === 'owner' && owners.length < 2) {
    throw fail(400, 'The account needs an owner.');
  }
  const members = account.members.filter((m) => m.email !== email);
  const memberEmails = (account.memberEmails || []).filter((e) => e !== email);
  const memberUids = (account.memberUids || []).filter((u) => u && u !== member.uid);
  await accounts().doc(account.id).update({ members, memberEmails, memberUids });
}

async function setDigest(account, email, digest) {
  const members = (account.members || []).map((m) => (
    m.email === email ? { ...m, digest: Boolean(digest) } : m
  ));
  await accounts().doc(account.id).update({ members });
}

function publicEngineer(row) {
  return {
    id: row.id,
    name: row.name || '',
    email: row.email,
    status: row.status || 'pending',
    profile: row.profile || 'needed',
  };
}

async function mfaRecord(uid) {
  return docData(await mfaDocs().doc(uid).get());
}

async function saveMfa(uid, data, opts) {
  const ref = mfaDocs().doc(uid);
  if (opts && opts.replace) await ref.set(data);
  else await ref.set(data, { merge: true });
}

async function consumeMfaBackup(uid, hash) {
  const ref = mfaDocs().doc(uid);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const hashes = snap.data().backupHashes || [];
    if (!hashes.includes(hash)) return false;
    tx.update(ref, {
      backupHashes: hashes.filter((item) => item !== hash),
      failures: 0,
      lockedUntil: '',
    });
    return true;
  });
}

async function deleteMfaForEmail(email) {
  const snap = await mfaDocs().where('email', '==', email).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
}

async function revokeAssistantAccess(email) {
  const [grants, keys] = await Promise.all([
    oauthGrants().where('email', '==', email).get(),
    connectors().where('email', '==', email).get(),
  ]);
  await Promise.all(grants.docs.concat(keys.docs).map((doc) => doc.ref.delete()));
}

async function engineerInviteFor(email) {
  const snap = await engineers().where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function listEngineers() {
  const snap = await engineers().get();
  return snap.docs
    .map((doc) => publicEngineer({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
}

async function saveEngineerInvite({ email, name }) {
  const now = new Date().toISOString();
  const existing = await engineerInviteFor(email);
  if (existing) {
    const nextName = name || existing.name || '';
    await engineers().doc(existing.id).update({ name: nextName });
    return publicEngineer({ ...existing, name: nextName });
  }
  const ref = await engineers().add({
    email,
    name: name || '',
    status: 'pending',
    profile: 'needed',
    createdAt: now,
  });
  return publicEngineer({
    id: ref.id, email, name: name || '', status: 'pending', profile: 'needed',
  });
}

async function claimEngineer(user) {
  const existing = await engineerInviteFor(user.email);
  if (!existing || existing.status === 'claimed') return existing ? publicEngineer(existing) : null;
  const name = user.name || existing.name || '';
  await engineers().doc(existing.id).update({
    status: 'claimed',
    uid: user.uid,
    name,
    claimedAt: new Date().toISOString(),
  });
  return publicEngineer({ ...existing, status: 'claimed', name });
}

async function setEngineerProfile(email) {
  const existing = await engineerInviteFor(email);
  if (!existing) return null;
  await engineers().doc(existing.id).update({ profile: 'opened' });
  return publicEngineer({ ...existing, profile: 'opened' });
}

async function listAccounts() {
  const snap = await accounts().get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function setReplyTime(id, replyTime) {
  await accounts().doc(id).update({ replyTime });
}

async function listAgents(accountId) {
  const snap = await accounts().doc(accountId).collection(AGENTS).get();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        chore: data.chore,
        status: data.status,
        last4: data.last4 || '',
        createdAt: data.createdAt,
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function createAgent(accountId, { name, chore }) {
  const cryptoKey = 'sk_' + crypto.randomBytes(24).toString('base64url');
  const ref = accounts().doc(accountId).collection(AGENTS).doc();
  const now = new Date().toISOString();
  await ref.set({
    name,
    chore,
    status: 'learning',
    last4: cryptoKey.slice(-4),
    createdAt: now,
  });
  await keys().doc(hashKey(cryptoKey)).set({
    accountId,
    agentId: ref.id,
    createdAt: now,
  });
  return { id: ref.id, name, chore, status: 'learning', apiKey: cryptoKey };
}

async function setAgentStatus(accountId, agentId, status) {
  if (!['learning', 'running', 'paused'].includes(status)) throw fail(400, 'Unknown status.');
  await accounts().doc(accountId).collection(AGENTS).doc(agentId).update({ status });
}

async function registerOauthClient({ clientName, redirectUris }) {
  const clientId = 'ocid_' + crypto.randomBytes(16).toString('base64url');
  const name = String(clientName || 'Assistant').trim().slice(0, 80) || 'Assistant';
  await oauthClients().doc(clientId).set({
    clientName: name,
    redirectUris,
    createdAt: new Date().toISOString(),
  });
  return { clientId, clientName: name, redirectUris };
}

async function oauthClient(clientId) {
  if (!String(clientId || '').startsWith('ocid_')) return null;
  return docData(await oauthClients().doc(String(clientId)).get());
}

async function issueOauthCode(fields) {
  const code = 'oc_' + crypto.randomBytes(24).toString('base64url');
  await oauthCodes().doc(hashKey(code)).set({
    clientId: fields.clientId,
    redirectUri: fields.redirectUri,
    codeChallenge: fields.codeChallenge,
    email: fields.email,
    name: fields.name || '',
    role: fields.role,
    accountId: fields.accountId || '',
    mfa: true,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return code;
}

async function takeOauthCode(code) {
  const ref = oauthCodes().doc(hashKey(String(code || '')));
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data();
    tx.delete(ref);
    if (!data.expiresAt || data.expiresAt < Date.now()) return null;
    return data;
  });
}

async function issueOauthGrant(fields) {
  if (fields.mfa !== true) return null;
  const access = 'oa_' + crypto.randomBytes(32).toString('base64url');
  const refresh = 'or_' + crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const body = {
    email: fields.email,
    name: fields.name || '',
    role: fields.role,
    accountId: fields.accountId || '',
    clientId: fields.clientId || '',
    mfa: true,
    accessExp: now + 60 * 60 * 1000,
    refreshExp: now + 90 * 24 * 60 * 60 * 1000,
  };
  const accessHash = hashKey(access);
  await oauthGrants().doc('a_' + accessHash).set({ kind: 'access', ...body });
  await oauthGrants().doc('r_' + hashKey(refresh)).set({ kind: 'refresh', accessHash, ...body });
  return { access, refresh, expiresIn: 3600 };
}

async function oauthAccess(token) {
  if (!String(token || '').startsWith('oa_')) return null;
  const data = await docData(await oauthGrants().doc('a_' + hashKey(token)).get());
  if (!data || data.kind !== 'access' || data.mfa !== true || !data.accessExp || data.accessExp < Date.now()) return null;
  return { role: data.role, email: data.email, name: data.name || '', accountId: data.accountId || '' };
}

async function rotateOauthGrant(refresh, clientId) {
  if (!String(refresh || '').startsWith('or_')) return null;
  const ref = oauthGrants().doc('r_' + hashKey(refresh));
  const data = await docData(await ref.get());
  if (!data || data.kind !== 'refresh' || data.mfa !== true) return null;
  const { sameClient } = require('./oauth');
  if (!sameClient(data.clientId, clientId)) return null;
  if (!data.refreshExp || data.refreshExp < Date.now()) {
    await ref.delete();
    return null;
  }
  await ref.delete();
  if (data.accessHash) await oauthGrants().doc('a_' + data.accessHash).delete().catch(() => {});
  return issueOauthGrant(data);
}

async function agentByKey(rawKey) {
  const snap = await keys().doc(hashKey(rawKey)).get();
  return docData(snap);
}

async function addActivity(accountId, event) {
  const ref = accounts().doc(accountId).collection(ACTIVITY).doc();
  const row = {
    ts: new Date().toISOString(),
    agentId: event.agentId || '',
    type: event.type,
    summary: event.summary,
    detail: event.detail || '',
    approvedBy: '',
  };
  await ref.set(row);
  let approvalId = '';
  if (event.type === 'needs_approval') {
    const approval = accounts().doc(accountId).collection(APPROVALS).doc();
    await approval.set({
      activityId: ref.id,
      agentId: row.agentId,
      summary: row.summary,
      status: 'pending',
      createdAt: row.ts,
      decidedBy: '',
    });
    approvalId = approval.id;
  }
  return { id: ref.id, approvalId, ...row };
}

async function listActivity(accountId, { limit = 50, type = '', agentId = '' } = {}) {
  const snap = await accounts().doc(accountId).collection(ACTIVITY).orderBy('ts', 'desc').limit(200).get();
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (type) rows = rows.filter((r) => r.type === type);
  if (agentId) rows = rows.filter((r) => r.agentId === agentId);
  return rows.slice(0, limit);
}

async function listApprovals(accountId, status) {
  const snap = await accounts().doc(accountId).collection(APPROVALS).get();
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (status) rows = rows.filter((r) => r.status === status);
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function decideApproval(accountId, approvalId, decision, email) {
  if (!['approved', 'declined'].includes(decision)) throw fail(400, 'Choose approved or declined.');
  const ref = accounts().doc(accountId).collection(APPROVALS).doc(approvalId);
  const snap = await ref.get();
  if (!snap.exists) throw fail(404, 'That approval is not here.');
  const data = snap.data();
  await ref.update({ status: decision, decidedBy: email, decidedAt: new Date().toISOString() });
  if (data.activityId) {
    await accounts().doc(accountId).collection(ACTIVITY).doc(data.activityId).update({ approvedBy: email });
  }
  return { id: approvalId, status: decision };
}

async function listRequests(accountId) {
  const snap = await accounts().doc(accountId).collection(REQUESTS).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function addRequest(accountId, { summary, email }) {
  const ref = accounts().doc(accountId).collection(REQUESTS).doc();
  const row = { summary, status: 'open', by: email, createdAt: new Date().toISOString() };
  await ref.set(row);
  return { id: ref.id, ...row };
}

async function closeRequest(accountId, requestId) {
  const ref = accounts().doc(accountId).collection(REQUESTS).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) throw fail(404, 'That request is not here.');
  await ref.update({ status: 'done', closedAt: new Date().toISOString() });
}

async function getAvailability() {
  const snap = await db().collection('studio_availability').doc('default').get();
  if (!snap.exists) return null;
  return snap.data();
}

async function saveAvailability(clean) {
  await db().collection('studio_availability').doc('default').set(clean);
  return clean;
}

async function addLead(row) {
  const ref = leads().doc();
  await ref.set({ ...row, createdAt: new Date().toISOString() });
  return ref.id;
}

async function listLeads() {
  const snap = await leads().get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50);
}

async function saveReport(accountId, month, body) {
  const id = accountId + '_' + month;
  await reports().doc(id).set({ accountId, month, ...body, createdAt: new Date().toISOString() });
  return id;
}

async function listReports(accountId) {
  const snap = await reports().where('accountId', '==', accountId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));
}

async function accountByCustomer(customerId) {
  const snap = await accounts().where('stripeCustomerId', '==', customerId).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function setBilling(accountId, patch) {
  await accounts().doc(accountId).update(patch);
}

module.exports = {
  ACCOUNTS,
  accounts,
  meetings,
  invites,
  engineers,
  engineerInviteFor,
  listEngineers,
  saveEngineerInvite,
  claimEngineer,
  setEngineerProfile,
  mfaRecord,
  saveMfa,
  consumeMfaBackup,
  deleteMfaForEmail,
  revokeAssistantAccess,
  locks,
  jobs,
  stripeEvents,
  hashKey,
  docData,
  clientAccount,
  accountById,
  accountForEmail,
  requireAccount,
  claimInvites,
  createAccount,
  inviteMember,
  removeMember,
  setDigest,
  listAccounts,
  setReplyTime,
  listAgents,
  createAgent,
  setAgentStatus,
  registerOauthClient,
  oauthClient,
  issueOauthCode,
  takeOauthCode,
  issueOauthGrant,
  oauthAccess,
  rotateOauthGrant,
  agentByKey,
  addActivity,
  listActivity,
  listApprovals,
  decideApproval,
  listRequests,
  addRequest,
  closeRequest,
  getAvailability,
  saveAvailability,
  addLead,
  listLeads,
  saveReport,
  listReports,
  accountByCustomer,
  setBilling,
};
