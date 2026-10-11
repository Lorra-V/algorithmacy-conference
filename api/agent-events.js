const core = require('../lib/submission-core');
const store = require('../lib/portal/db');
const { send, fail, readJson } = require('../lib/portal/http');
const { validateEvent } = require('../lib/portal/validate');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw fail(405, 'Method not allowed.');
    const header = req.headers.authorization || '';
    const match = String(header).match(/^Bearer\s+(\S+)$/);
    if (!match) throw fail(401, 'A key is required.');
    const agent = await store.agentByKey(match[1]);
    if (!agent) throw fail(401, 'That key is not recognized.');
    try {
      if (await core.rateLimited({ bucket: 'studio:agent:' + agent.agentId })) {
        throw fail(429, 'Too many events. Try again in an hour.');
      }
    } catch (e) {
      if (e.status) throw e;
      console.error('studio agent rate-limit', e);
    }
    const body = await readJson(req);
    const { errors, clean } = validateEvent(body);
    if (errors.length) throw fail(400, errors[0]);
    const activity = await store.addActivity(agent.accountId, { ...clean, agentId: agent.agentId });
    send(res, 200, { ok: true, id: activity.id, approvalId: activity.approvalId || '' });
  } catch (e) {
    const status = e.status || (e instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error('studio agent event', e);
    if (!res.writableEnded) {
      send(res, status, { error: status >= 500 ? 'Something went wrong.' : e.message });
    }
  }
};
