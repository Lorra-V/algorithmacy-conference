const QRCode = require('qrcode');
const store = require('./db');
const { fail } = require('./http');
const {
  generateSecret, verifyTotp, otpauthUri, backupCodes, hashBackup,
  failurePatch, isLocked, seal, openSecret, issueProof, readProof,
} = require('./totp');

function mfaError(status, message, gate) {
  const err = fail(status, message);
  if (gate) err.mfa = gate;
  return err;
}

async function gate(user, req) {
  const rec = await store.mfaRecord(user.uid);
  if (!rec || !rec.enabled || !rec.secretEnc) return 'enroll';
  try {
    openSecret(rec.secretEnc);
  } catch {
    return 'enroll';
  }
  const header = (req.headers && (req.headers['x-studio-mfa'] || req.headers['X-Studio-Mfa'])) || '';
  if (readProof(header, user.uid, Date.now())) return 'ok';
  return 'verify';
}

async function enroll(user) {
  const existing = await store.mfaRecord(user.uid);
  if (existing && existing.enabled) throw mfaError(409, 'An authenticator is already set up.', 'verify');
  const secret = generateSecret();
  const now = new Date().toISOString();
  await store.saveMfa(user.uid, {
    email: user.email,
    secretEnc: seal(secret),
    enabled: false,
    backupHashes: [],
    failures: 0,
    lockedUntil: '',
    createdAt: now,
  }, { replace: true });
  const otpauth = otpauthUri(user.email, secret);
  const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 196, errorCorrectionLevel: 'M' });
  return { secret, otpauth, qr };
}

async function confirm(user, code) {
  const rec = await store.mfaRecord(user.uid);
  if (!rec || !rec.secretEnc) throw mfaError(400, 'Set up the authenticator first.', 'enroll');
  if (rec.enabled) throw mfaError(409, 'An authenticator is already set up.', 'verify');
  let secret;
  try { secret = openSecret(rec.secretEnc); }
  catch { throw mfaError(500, 'The authenticator secret could not be read.'); }
  if (!verifyTotp(secret, code, Date.now())) throw mfaError(401, 'That code is not right.');
  const codes = backupCodes();
  await store.saveMfa(user.uid, {
    email: user.email,
    enabled: true,
    backupHashes: codes.map(hashBackup),
    failures: 0,
    lockedUntil: '',
    confirmedAt: new Date().toISOString(),
  });
  return { proof: issueProof(user.uid, Date.now()), backupCodes: codes };
}

async function verify(user, code) {
  const rec = await store.mfaRecord(user.uid);
  if (!rec || !rec.enabled || !rec.secretEnc) throw mfaError(403, 'Set up an authenticator before opening the portal.', 'enroll');
  const now = Date.now();
  if (isLocked(rec.lockedUntil, now)) throw mfaError(429, 'Too many attempts. Try again in 15 minutes.', 'verify');
  let secret;
  try { secret = openSecret(rec.secretEnc); }
  catch { throw mfaError(403, 'Set up an authenticator before opening the portal.', 'enroll'); }
  if (verifyTotp(secret, code, now)) {
    await store.saveMfa(user.uid, { failures: 0, lockedUntil: '' });
    return { proof: issueProof(user.uid, now) };
  }
  const hash = hashBackup(code);
  if (hash && (rec.backupHashes || []).includes(hash)) {
    const used = await store.consumeMfaBackup(user.uid, hash);
    if (!used) throw mfaError(401, 'That code is not right.', 'verify');
    return { proof: issueProof(user.uid, now) };
  }
  const patch = failurePatch(rec.failures, now);
  await store.saveMfa(user.uid, patch);
  if (patch.lockedUntil) throw mfaError(429, 'Too many attempts. Try again in 15 minutes.', 'verify');
  throw mfaError(401, 'That code is not right.', 'verify');
}

module.exports = { gate, enroll, confirm, verify };
