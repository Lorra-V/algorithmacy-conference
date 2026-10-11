const { run } = require('../lib/portal/jobs');
const { send, queryValue } = require('../lib/portal/http');

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === 'Bearer ' + secret;
}

module.exports = async (req, res) => {
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
};
