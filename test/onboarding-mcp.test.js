const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/submission-core');
const booking = require('../lib/portal/booking');
const { callTool, handleRpc } = require('../lib/portal/onboarding-mcp');

test('engineer_application names Your Engineers and does not sign anyone in', async () => {
  const result = await callTool('engineer_application', { name: 'Joseph Example' });
  assert.equal(result.isError, undefined);
  const body = result.content[0].text;
  assert.match(body, /Your Engineers/);
  assert.match(body, /A pull request does not sign anyone in/);
  assert.match(body, /images\/speakers\/joseph-example\.jpg/);
  assert.match(body, /only after an invite/);
  assert.doesNotMatch(body, /The engineer/);
});

test('book_discovery rejects a missing email', async () => {
  const result = await callTool('book_discovery', {
    name: 'Ada',
    business: 'Harbor',
    start: new Date().toISOString(),
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /email/i);
});

test('a successful book reply says the call is not an account', async () => {
  const rate = core.enforceRate;
  const create = booking.createMeeting;
  core.enforceRate = async () => {};
  booking.createMeeting = async () => ({ when: 'Thursday, October 16, 10:00 AM EDT' });
  try {
    const result = await callTool('book_discovery', {
      name: 'Ada Client',
      email: 'ada@example.com',
      business: 'Harbor Test',
      start: new Date(Date.now() + 86400000).toISOString(),
    }, { ip: '127.0.0.1' });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /not an account/);
    assert.match(result.content[0].text, /Thursday, October 16/);
  } finally {
    core.enforceRate = rate;
    booking.createMeeting = create;
  }
});

test('initialize says a call is not an account', async () => {
  const result = await handleRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  });
  assert.equal(result.result.serverInfo.name, 'algorithmacy-studio-onboarding');
  assert.match(result.result.instructions, /not an account/);
  const listed = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = listed.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    'studio_offer',
    'list_discovery_times',
    'book_discovery',
    'write_studio',
    'engineer_application',
  ]);
});
