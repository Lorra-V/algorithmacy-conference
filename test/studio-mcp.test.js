const test = require('node:test');
const assert = require('node:assert/strict');
const { publicTools, callTool, handleRpc, agentKeyMessage } = require('../lib/portal/studio-mcp');

test('a client connection cannot see engineer tools', () => {
  const names = publicTools('client').map((tool) => tool.name);
  assert.ok(names.includes('list_agents'));
  assert.ok(names.includes('subscription'));
  assert.ok(names.includes('book_call'));
  assert.equal(names.includes('list_accounts'), false);
  assert.equal(names.includes('create_agent'), false);
  assert.equal(names.includes('set_agent_flow'), false);
  assert.equal(names.includes('post_report'), false);
  assert.equal(names.includes('create_account'), false);
});

test('an engineer connection can open offices and still read one office', () => {
  const names = publicTools('engineer').map((tool) => tool.name);
  assert.ok(names.includes('list_accounts'));
  assert.ok(names.includes('create_agent'));
  assert.ok(names.includes('set_agent_flow'));
  assert.ok(names.includes('post_report'));
  assert.ok(names.includes('list_reports'));
  assert.equal(names.includes('whoami'), true);
});

test('a client cannot write an agent flow', async () => {
  const ctx = { role: 'client', email: 'ada@harborfinch.example', name: 'Ada', accountId: 'harbor' };
  const result = await callTool(ctx, 'set_agent_flow', { agentId: 'intake', steps: ['A new inquiry arrives.'] });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not on this connection/);
});

test('an agent flow is rejected before any office lookup when it is too long', async () => {
  const ctx = { role: 'engineer', email: 'roger@algorithmacy.org', name: 'Roger', accountId: '' };
  const steps = Array.from({ length: 13 }, (_, i) => 'Step number ' + (i + 1));
  const result = await callTool(ctx, 'set_agent_flow', { agentId: 'intake', steps });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /12/);
});

test('a client key cannot open another office or an engineer tool', async () => {
  const ctx = { role: 'client', email: 'ada@harborfinch.example', name: 'Ada', accountId: 'harbor' };
  const other = await callTool(ctx, 'list_agents', { accountId: 'someone-else' });
  assert.equal(other.isError, true);
  assert.match(other.content[0].text, /one office/);
  const engineer = await callTool(ctx, 'list_accounts', {});
  assert.equal(engineer.isError, true);
  assert.match(engineer.content[0].text, /not on this connection/);
});

test('an engineer tool asks for the office before it reads anything', async () => {
  const ctx = { role: 'engineer', email: 'roger@algorithmacy.org', name: 'Roger', accountId: '' };
  const result = await callTool(ctx, 'list_reports', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /accountId/);
});

test('initialize tells each side what the connection can do', async () => {
  const client = await handleRpc(
    { role: 'client', email: 'ada@harborfinch.example', accountId: 'harbor' },
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
  );
  assert.match(client.result.instructions, /cannot charge a card/);
  assert.equal(client.result.serverInfo.name, 'algorithmacy-studio');
  const listed = await handleRpc(
    { role: 'engineer', email: 'roger@algorithmacy.org', accountId: '' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  );
  assert.ok(listed.result.tools.some((tool) => tool.name === 'list_accounts'));
});

function capture() {
  const headers = {};
  let status = 0;
  let body = '';
  const res = {
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(s) { body = s || ''; },
  };
  Object.defineProperty(res, 'statusCode', { set(v) { status = v; } });
  return { res, headers, status: () => status, body: () => body };
}

test('the connector starts OAuth when there is no token', async () => {
  const handler = require('../api/studio-mcp');
  const cap = capture();
  await handler({ method: 'POST', headers: {}, url: '/api/studio-mcp' }, cap.res);
  assert.equal(cap.status(), 401);
  assert.match(cap.body(), /Sign in is required/);
  assert.match(cap.headers['www-authenticate'], /resource_metadata="https:\/\/algorithmacy\.org\/\.well-known\/oauth-protected-resource"/);
  assert.equal(/invalid_token/.test(cap.headers['www-authenticate']), false);
});

test('a token that is not a Studio token is invalid_token', async () => {
  const handler = require('../api/studio-mcp');
  const cap = capture();
  await handler({ method: 'GET', headers: { authorization: 'Bearer nope' }, url: '/api/studio-mcp' }, cap.res);
  assert.equal(cap.status(), 401);
  assert.match(cap.headers['www-authenticate'], /invalid_token/);
});

test('a key in the URL is not a sign-in', async () => {
  const handler = require('../api/studio-mcp');
  const cap = capture();
  await handler({
    method: 'POST',
    headers: {},
    url: '/api/studio-mcp?key=ck_secret',
    query: { key: 'ck_secret' },
  }, cap.res);
  assert.equal(cap.status(), 401);
  assert.match(cap.body(), /Sign in is required/);
  assert.equal(/invalid_token/.test(cap.headers['www-authenticate']), false);
});

test('create_agent does not put the key in the assistant reply', () => {
  const message = agentKeyMessage('Intake', 'agent-1');
  assert.doesNotMatch(message, /sk_/);
  assert.match(message, /account page/);
  assert.match(message, /15 minutes/);
});

test('a connector key is not accepted', async () => {
  const handler = require('../api/studio-mcp');
  const cap = capture();
  await handler({ method: 'POST', headers: { authorization: 'Bearer ck_secret' }, url: '/api/studio-mcp' }, cap.res);
  assert.equal(cap.status(), 401);
  assert.match(cap.headers['www-authenticate'], /invalid_token/);
});

test('an engineer token is refused until the profile is merged and invited', async () => {
  const store = require('../lib/portal/db');
  const access = store.oauthAccess;
  const invite = store.engineerInviteFor;
  store.oauthAccess = async () => ({ role: 'engineer', email: 'ada@example.com', name: 'Ada Missing' });
  store.engineerInviteFor = async () => ({ email: 'ada@example.com', name: 'Ada Missing' });
  try {
    const handler = require('../api/studio-mcp');
    const cap = capture();
    await handler({ method: 'POST', headers: { authorization: 'Bearer oa_test' }, url: '/api/studio-mcp' }, cap.res);
    assert.equal(cap.status(), 401);
    assert.match(cap.body(), /not an engineer yet/);
    assert.doesNotMatch(cap.body(), /[Ff]irebase/);
  } finally {
    store.oauthAccess = access;
    store.engineerInviteFor = invite;
  }
});

test('a merged invited engineer keeps the office connection', async () => {
  const store = require('../lib/portal/db');
  const access = store.oauthAccess;
  const invite = store.engineerInviteFor;
  store.oauthAccess = async () => ({ role: 'engineer', email: 'lorraine@example.com', name: 'Lorraine Villaroel' });
  store.engineerInviteFor = async () => ({ email: 'lorraine@example.com', name: 'Lorraine Villaroel' });
  try {
    const handler = require('../api/studio-mcp');
    const cap = capture();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer oa_test', 'content-type': 'application/json' },
      url: '/api/studio-mcp',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    }, cap.res);
    assert.notEqual(cap.status(), 401);
  } finally {
    store.oauthAccess = access;
    store.engineerInviteFor = invite;
  }
});
