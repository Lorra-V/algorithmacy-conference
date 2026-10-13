// Public Studio onboarding connector. No key and no OAuth.
// POST https://algorithmacy.org/api/onboarding-mcp
//
// A booked call is not an account. A pull request does not sign an engineer in.
// The conference connector stays at /api/mcp. The signed-in portal connector
// stays at /api/studio-mcp.

const { clientIp } = require('../lib/portal/http');
const { handleRpc } = require('../lib/portal/onboarding-mcp');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'POST JSON-RPC to this endpoint. No login is required.' },
    }));
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
  }

  const ctx = { ip: clientIp(req) };
  if (Array.isArray(body)) {
    let out;
    try {
      out = (await Promise.all(body.map((msg) => handleRpc(msg, ctx)))).filter(Boolean);
    } catch (error) {
      if (error.status === 503) return unavailable(res);
      throw error;
    }
    if (!out.length) {
      res.statusCode = 202;
      return res.end();
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(out));
  }

  let out;
  try {
    out = await handleRpc(body, ctx);
  } catch (error) {
    if (error.status === 503) return unavailable(res);
    throw error;
  }
  if (!out) {
    res.statusCode = 202;
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(out));
};

function unavailable(res) {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32000, message: 'The connector is not available right now. Try again shortly.' },
  }));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
