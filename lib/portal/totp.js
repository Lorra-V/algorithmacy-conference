const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
const FAIL_LIMIT = 5;
const LOCK_MS = 15 * 60 * 1000;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx < 0) {
      const err = new Error('That authenticator secret is not valid.');
      err.status = 400;
      throw err;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBytes, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3];
  return String(bin % 1000000).padStart(6, '0');
}

function totpAt(secret, now) {
  const bytes = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const counter = Math.floor(Number(now) / 1000 / STEP);
  return hotp(bytes, counter);
}

function verifyTotp(secret, code, now) {
  const cleaned = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  let bytes;
  try {
    bytes = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  } catch {
    return false;
  }
  const counter = Math.floor(Number(now) / 1000 / STEP);
  const given = Buffer.from(cleaned);
  for (let skew = -1; skew <= 1; skew += 1) {
    const expected = Buffer.from(hotp(bytes, counter + skew));
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) return true;
  }
  return false;
}

function otpauthUri(email, secret) {
  const label = encodeURIComponent('Algorithmacy:' + email);
  const query = new URLSearchParams({
    secret: secret,
    issuer: 'Algorithmacy',
    algorithm: 'SHA1',
    digits: '6',
    period: String(STEP),
  });
  return 'otpauth://totp/' + label + '?' + query.toString();
}

function backupCodes() {
  const codes = [];
  for (let i = 0; i < 8; i += 1) {
    const raw = crypto.randomBytes(4).toString('hex');
    codes.push(raw.slice(0, 4) + '-' + raw.slice(4));
  }
  return codes;
}

function hashBackup(code) {
  const norm = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm.length < 8) return '';
  return crypto.createHmac('sha256', keyMaterial()).update(norm).digest('hex');
}

function failurePatch(failures, now) {
  const next = (Number(failures) || 0) + 1;
  if (next >= FAIL_LIMIT) {
    return { failures: 0, lockedUntil: new Date(Number(now) + LOCK_MS).toISOString() };
  }
  return { failures: next, lockedUntil: '' };
}

function isLocked(lockedUntil, now) {
  const at = Date.parse(lockedUntil || '');
  return Number.isFinite(at) && at > Number(now);
}

function keyMaterial() {
  const raw = process.env.STUDIO_MFA_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) {
    const err = new Error('MFA is not configured.');
    err.status = 503;
    throw err;
  }
  return crypto.createHash('sha256').update('studio-mfa-v1\0').update(raw).digest();
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function openSecret(packed) {
  const buf = Buffer.from(String(packed || ''), 'base64');
  if (buf.length < 29) {
    const err = new Error('The authenticator secret could not be read.');
    err.status = 500;
    throw err;
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

const PROOF_MS = 12 * 60 * 60 * 1000;

function issueProof(uid, now) {
  const exp = Number(now) + PROOF_MS;
  const payload = uid + '.' + exp;
  const sig = crypto.createHmac('sha256', keyMaterial()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function readProof(token, uid, now) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [tokenUid, expStr, sig] = parts;
  if (!tokenUid || tokenUid !== uid) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Number(now)) return false;
  const expected = crypto.createHmac('sha256', keyMaterial()).update(tokenUid + '.' + expStr).digest('base64url');
  const given = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

module.exports = {
  generateSecret,
  hotp,
  totpAt,
  verifyTotp,
  otpauthUri,
  backupCodes,
  hashBackup,
  failurePatch,
  isLocked,
  seal,
  openSecret,
  issueProof,
  readProof,
  FAIL_LIMIT,
  LOCK_MS,
  PROOF_MS,
};
