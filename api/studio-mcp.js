// Studio connector for Claude, Cursor, and Grok.
// POST https://algorithmacy.org/api/studio-mcp
// Authorization: Bearer <oauth access token issued after the authenticator>.
// The conference submission connector stays at /api/mcp and is not this.

const core = require('../lib/submission-core');
const store = require('../lib/portal/db');
const { siteUrl } = require('../lib/portal/http');
const { wwwAuthenticate } = require('../lib/portal/oauth');
const { handleRpc } = require('../lib/portal/studio-mcp');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'POST JSON-RPC to this endpoint.' } }));
  }

  const token = keyFrom(req);
  let row;
  try {
    row = await actorFrom(token);
  } catch (e) {
    console.error('studio mcp key', e);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'The connector is not open yet.' } }));
  }
  if (!row) return deny(res, token ? 'invalid_token' : '');
  if (req.method === 'GET') {
    res.statusCode = 405;
    res.setHeader('WWW-Authenticate', wwwAuthenticate(siteUrl(), ''));
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'POST JSON-RPC to this endpoint. Sign in with OAuth.' },
    }));
  }

  try {
    if (await core.rateLimited({ bucket: 'studio:mcp:' + (row.email || row.id || 'unknown') })) {
      res.statusCode = 429;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests. Try again in an hour.' } }));
    }
  } catch (e) {
    console.error('studio mcp rate-limit', e);
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
  }

  const ctx = {
    role: row.role,
    email: row.email,
    name: row.name || '',
    accountId: row.accountId || '',
  };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((msg) => handleRpc(ctx, msg)))).filter(Boolean);
    if (!out.length) {
      res.statusCode = 202;
      return res.end();
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(out));
  }
  const out = await handleRpc(ctx, body);
  if (!out) {
    res.statusCode = 202;
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(out));
};

function deny(res, error) {
  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', wwwAuthenticate(siteUrl(), error));
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32001, message: 'Sign in is required.' },
  }));
}

async function actorFrom(token) {
  if (!token || !String(token).startsWith('oa_')) return null;
  const row = await store.oauthAccess(token);
  if (!row || (row.role !== 'engineer' && row.role !== 'client')) return null;
  return row;
}

function keyFrom(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = String(header).match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : '';
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
