const assert = require('node:assert/strict');
const test = require('node:test');
const { hotp, totpAt, verifyTotp, generateSecret, hashBackup, failurePatch, isLocked, seal, openSecret, issueProof, readProof } = require('../lib/portal/totp');

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

test('TOTP matches the RFC 6238 SHA1 vectors', () => {
  assert.equal(hotp(RFC_SECRET, 1), '287082');
  assert.equal(totpAt(RFC_SECRET, 59 * 1000), '287082');
  assert.equal(totpAt(RFC_SECRET, 1111111109 * 1000), '081804');
  assert.equal(verifyTotp(RFC_SECRET, '287082', 59 * 1000), true);
  assert.equal(verifyTotp(RFC_SECRET, '287082', 59 * 1000 + 30000), true);
  assert.equal(verifyTotp(RFC_SECRET, '000000', 59 * 1000), false);
  assert.equal(verifyTotp(RFC_SECRET, 'nope', 59 * 1000), false);
});

test('a generated secret verifies only its current code', () => {
  const secret = generateSecret();
  const now = Date.parse('2026-10-12T18:00:00.000Z');
  const code = totpAt(secret, now);
  assert.equal(verifyTotp(secret, code, now), true);
  assert.equal(verifyTotp(secret, code, now + 90 * 1000), false);
});

test('backup codes ignore dashes and the fifth failure locks for 15 minutes', () => {
  const hash = hashBackup('ab12-cd34');
  assert.equal(hashBackup('AB12 CD34'), hash);
  assert.equal(hashBackup('123456'), '');
  const now = Date.parse('2026-10-12T18:00:00.000Z');
  assert.deepEqual(failurePatch(3, now), { failures: 4, lockedUntil: '' });
  const locked = failurePatch(4, now);
  assert.equal(locked.failures, 0);
  assert.equal(isLocked(locked.lockedUntil, now), true);
  assert.equal(isLocked(locked.lockedUntil, now + 15 * 60 * 1000), false);
});

test('the authenticator secret and the session proof stay bound to this server', () => {
  process.env.STUDIO_MFA_KEY = 'test-mfa-key';
  const packed = seal('JBSWY3DPEHPK3PXP');
  assert.equal(openSecret(packed), 'JBSWY3DPEHPK3PXP');
  const proof = issueProof('uid-1', 1_000);
  assert.equal(readProof(proof, 'uid-1', 1_000), true);
  assert.equal(readProof(proof, 'uid-2', 1_000), false);
  assert.equal(readProof(proof, 'uid-1', 1_000 + (12 * 60 * 60 * 1000) + 1), false);
  assert.throws(() => openSecret(packed.slice(0, 8)));
});

test('portal MFA routes refuse a request with no sign-in', async () => {
  const { dispatch } = require('../lib/portal/handlers');
  for (const path of ['mfa/enroll', 'mfa/verify', 'me']) {
    let body = '';
    const res = {
      statusCode: 0,
      setHeader() {},
      end(s) { body = s; this.writableEnded = true; },
    };
    await dispatch({
      method: path === 'me' ? 'GET' : 'POST',
      url: '/api/portal?path=' + path,
      query: { path },
      headers: {},
      body: {},
    }, res);
    assert.equal(res.statusCode, 401, path);
    assert.match(JSON.parse(body).error, /sign in/i);
  }
});
