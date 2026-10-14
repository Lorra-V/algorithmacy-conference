const crypto = require('node:crypto');
const { run } = require('../lib/portal/jobs');
const { send, queryValue } = require('../lib/portal/http');

function bearerMatches(header, secret) {
  const given = String(header || '');
  const expected = 'Bearer ' + String(secret || '');
  if (!secret || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function authorized(req) {
  return bearerMatches(req.headers && req.headers.authorization, process.env.CRON_SECRET);
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, { error: 'Method not allowed.' });
  }
  if (!authorized(req)) return send(res, 401, { error: 'Unauthorized.' });
  try {
    const result = await run(queryValue(req, 'job'));
    send(res, 200, result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('studio cron', e);
    if (!res.writableEnded) send(res, status, { error: status >= 500 ? 'Something went wrong.' : e.message });
  }
}

handler.bearerMatches = bearerMatches;
module.exports = handler;
