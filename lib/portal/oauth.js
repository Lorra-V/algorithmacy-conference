const crypto = require('crypto');

function pkceS256(verifier, challenge) {
  const value = String(verifier || '');
  if (value.length < 43 || value.length > 128) return false;
  if (!/^[\x21-\x7E]+$/.test(value)) return false;
  const hash = crypto.createHash('sha256').update(value).digest('base64url');
  const left = Buffer.from(hash);
  const right = Buffer.from(String(challenge || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function impersonatesStudio(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'algorithmacy.org' || host.endsWith('.algorithmacy.org') || host.includes('algorithmacy');
}

function redirectHosts() {
  const raw = process.env.STUDIO_OAUTH_REDIRECT_HOSTS;
  const source = raw == null || String(raw).trim() === '' ? 'claude.ai,cursor.com' : raw;
  return String(source)
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
}

function hostAllowed(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return redirectHosts().some((allowed) => host === allowed || host.endsWith('.' + allowed));
}

function safeRedirectUri(uri) {
  let url;
  try {
    url = new URL(String(uri || ''));
  } catch (e) {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (impersonatesStudio(url.hostname)) return false;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (local) return url.protocol === 'http:' || url.protocol === 'https:';
  return url.protocol === 'https:' && hostAllowed(url.hostname);
}

function sameClient(stored, given) {
  const left = String(stored || '');
  const right = String(given || '');
  return Boolean(left && right && left === right);
}

function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: origin + '/oauth/authorize',
    token_endpoint: origin + '/api/oauth/token',
    registration_endpoint: origin + '/api/oauth/register',
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['studio'],
  };
}

function protectedResourceMetadata(origin) {
  return {
    resource: origin + '/api/studio-mcp',
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['studio'],
  };
}

function wwwAuthenticate(origin, error) {
  const bits = ['Bearer realm="algorithmacy-studio"'];
  if (error) bits.push('error="' + error + '"');
  bits.push('resource_metadata="' + origin + '/.well-known/oauth-protected-resource"');
  return bits.join(', ');
}

function validChallenge(value) {
  return /^[A-Za-z0-9\-_]{43,128}$/.test(String(value || ''));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function oauthError(res, status, error, description) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error, error_description: description }));
}

async function readOauthFields(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    raw = Buffer.concat(chunks).toString('utf8');
  }
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch (e) { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(trimmed));
}

module.exports = {
  pkceS256,
  safeRedirectUri,
  impersonatesStudio,
  sameClient,
  validChallenge,
  authorizationServerMetadata,
  protectedResourceMetadata,
  wwwAuthenticate,
  cors,
  oauthError,
  readOauthFields,
};
