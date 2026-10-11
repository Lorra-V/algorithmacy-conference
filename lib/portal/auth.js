const { auth, configured } = require('./firebase-admin');

function adminEmails() {
  return (process.env.STUDIO_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function callerFromRequest(req) {
  const header = req.headers.authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  if (!configured()) {
    const err = new Error('Sign-in is not configured.');
    err.status = 503;
    throw err;
  }
  let decoded;
  try {
    decoded = await auth().verifyIdToken(match[1]);
  } catch {
    const err = new Error('Sign in again.');
    err.status = 401;
    throw err;
  }
  const email = String(decoded.email || '').toLowerCase();
  if (!email) {
    const err = new Error('This sign-in has no email address.');
    err.status = 401;
    throw err;
  }
  const isAdmin = decoded.studioAdmin === true || adminEmails().includes(email);
  return {
    uid: decoded.uid,
    email,
    name: typeof decoded.name === 'string' ? decoded.name : '',
    isAdmin,
  };
}

module.exports = { callerFromRequest, adminEmails };
