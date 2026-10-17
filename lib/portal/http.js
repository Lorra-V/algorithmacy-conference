function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readRaw(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function siteUrl() {
  return (process.env.SITE_URL || 'https://algorithmacy.org').replace(/\/$/, '');
}

function safePortalNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/portal/') || raw.startsWith('//')) return '/portal/';
  return raw;
}

function finishSignInUrl(next) {
  const dest = safePortalNext(next);
  const base = siteUrl() + '/portal/login/finish/';
  if (!dest || dest === '/portal/') return base;
  return base + '?next=' + encodeURIComponent(dest);
}

function canPayAccount(account, user) {
  if (!account || !user) return false;
  return account.role === 'owner' || !!user.isAdmin;
}

function requirePayer(account, user, message) {
  if (!canPayAccount(account, user)) throw fail(403, message || 'An owner pays.');
}

function bookedMessage(mailed) {
  if (mailed === false) {
    return 'The call is booked. The confirmation email did not send. Use the link below to change or cancel it.';
  }
  return 'A confirmation is on its way, with a calendar file.';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function routeParts(req) {
  const q = req.query || {};
  if (Array.isArray(q.route)) return q.route.map(String).filter(Boolean);
  if (typeof q.route === 'string' && q.route) return q.route.split('/').filter(Boolean);
  if (typeof q.path === 'string' && q.path) return q.path.split('/').filter(Boolean);
  const path = String(req.url || '').split('?')[0];
  const marker = '/api/portal/';
  const i = path.indexOf(marker);
  if (i === -1) return [];
  return decodeURIComponent(path.slice(i + marker.length)).split('/').filter(Boolean);
}

function queryValue(req, key) {
  const q = req.query || {};
  const v = q[key];
  if (Array.isArray(v)) return v[0] || '';
  if (typeof v === 'string') return v;
  const url = String(req.url || '');
  const i = url.indexOf('?');
  if (i === -1) return '';
  return new URLSearchParams(url.slice(i + 1)).get(key) || '';
}

module.exports = {
  send, fail, readJson, readRaw, clientIp, siteUrl, escapeHtml, routeParts, queryValue,
  safePortalNext, finishSignInUrl, canPayAccount, requirePayer, bookedMessage,
};
