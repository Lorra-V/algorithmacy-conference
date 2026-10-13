const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  pkceS256, safeRedirectUri, sameClient, authorizationServerMetadata, protectedResourceMetadata, wwwAuthenticate,
} = require('../lib/portal/oauth');

test('PKCE S256 accepts the matching verifier and rejects a lookalike', () => {
  const verifier = 'a'.repeat(43);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.equal(pkceS256(verifier, challenge), true);
  assert.equal(pkceS256(verifier + 'b', challenge), false);
  assert.equal(pkceS256('short', challenge), false);
});

test('only https and localhost redirects are allowed', () => {
  const prev = process.env.STUDIO_OAUTH_REDIRECT_HOSTS;
  delete process.env.STUDIO_OAUTH_REDIRECT_HOSTS;
  try {
    assert.equal(safeRedirectUri('https://claude.ai/api/mcp/auth_callback'), true);
    assert.equal(safeRedirectUri('https://www.cursor.com/cb'), true);
    assert.equal(safeRedirectUri('https://evil.example/callback'), false);
    assert.equal(safeRedirectUri('http://127.0.0.1:33418/callback'), true);
    assert.equal(safeRedirectUri('http://localhost:8787/cb'), true);
    assert.equal(safeRedirectUri('http://evil.example/callback'), false);
    assert.equal(safeRedirectUri('javascript:alert(1)'), false);
    assert.equal(safeRedirectUri('https://user:pass@claude.ai/cb'), false);
    assert.equal(safeRedirectUri('https://algorithmacy.org/cb'), false);
    assert.equal(safeRedirectUri('https://algorithmacy.org.evil.test/cb'), false);
    assert.equal(safeRedirectUri('https://login-algorithmacy.org/cb'), false);
    process.env.STUDIO_OAUTH_REDIRECT_HOSTS = '';
    assert.equal(safeRedirectUri('https://claude.ai/cb'), true);
    process.env.STUDIO_OAUTH_REDIRECT_HOSTS = 'grok.com';
    assert.equal(safeRedirectUri('https://grok.com/oauth/callback'), true);
    assert.equal(safeRedirectUri('https://claude.ai/cb'), false);
  } finally {
    if (prev === undefined) delete process.env.STUDIO_OAUTH_REDIRECT_HOSTS;
    else process.env.STUDIO_OAUTH_REDIRECT_HOSTS = prev;
  }
});

test('a refresh must name the same client', () => {
  assert.equal(sameClient('ocid_a', 'ocid_a'), true);
  assert.equal(sameClient('ocid_a', ''), false);
  assert.equal(sameClient('', 'ocid_a'), false);
  assert.equal(sameClient('ocid_a', 'ocid_b'), false);
});

test('discovery documents point at the Studio connector', () => {
  const origin = 'https://algorithmacy.org';
  const as = authorizationServerMetadata(origin);
  assert.equal(as.authorization_endpoint, origin + '/oauth/authorize');
  assert.equal(as.token_endpoint, origin + '/api/oauth/token');
  assert.equal(as.registration_endpoint, origin + '/api/oauth/register');
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  const resource = protectedResourceMetadata(origin);
  assert.equal(resource.resource, origin + '/api/studio-mcp');
  assert.deepEqual(resource.authorization_servers, [origin]);
  assert.match(wwwAuthenticate(origin, ''), /resource_metadata=/);
});

test('registration rejects an address that pretends to be Algorithmacy', async () => {
  const handler = require('../api/oauth/register');
  let status = 0;
  let body = '';
  const res = {
    setHeader() {},
    end(s) { body = s; },
  };
  Object.defineProperty(res, 'statusCode', { set(v) { status = v; } });
  await handler({
    method: 'POST',
    headers: {},
    body: { redirect_uris: ['https://algorithmacy.org.evil.test/cb'], token_endpoint_auth_method: 'none' },
  }, res);
  assert.equal(status, 400);
  assert.equal(JSON.parse(body).error, 'invalid_redirect_uri');
});

test('the old connector key route is closed', async () => {
  const { dispatch } = require('../lib/portal/handlers');
  let status = 0;
  let body = '';
  const res = {
    setHeader() {},
    end(s) { body = s; },
  };
  Object.defineProperty(res, 'statusCode', { set(v) { status = v; } });
  await dispatch({
    method: 'POST',
    url: '/api/portal?path=connector',
    query: { path: 'connector' },
    headers: {},
    body: {},
  }, res);
  assert.equal(status, 410);
  assert.match(JSON.parse(body).error, /no key to copy/i);
});
test('registration rejects a redirect that is not https or localhost', async () => {
  const handler = require('../api/oauth/register');
  let status = 0;
  let body = '';
  const res = {
    setHeader() {},
    end(s) { body = s; },
  };
  Object.defineProperty(res, 'statusCode', { set(v) { status = v; } });
  await handler({
    method: 'POST',
    headers: {},
    body: { redirect_uris: ['javascript:alert(1)'], token_endpoint_auth_method: 'none' },
  }, res);
  assert.equal(status, 400);
  assert.equal(JSON.parse(body).error, 'invalid_redirect_uri');

  await handler({
    method: 'POST',
    headers: {},
    body: { redirect_uris: ['https://evil.example/cb'], token_endpoint_auth_method: 'none' },
  }, res);
  assert.equal(status, 400);
  assert.equal(JSON.parse(body).error, 'invalid_redirect_uri');
});

test('the token endpoint refuses a grant it does not offer', async () => {
  const handler = require('../api/oauth/token');
  let status = 0;
  let body = '';
  const res = {
    setHeader() {},
    end(s) { body = s; },
  };
  Object.defineProperty(res, 'statusCode', { set(v) { status = v; } });
  await handler({ method: 'POST', headers: {}, body: { grant_type: 'password' } }, res);
  assert.equal(status, 400);
  assert.equal(JSON.parse(body).error, 'unsupported_grant_type');
});

test('the token endpoint refuses a different resource', async () => {
  const handler = require('../api/oauth/token');
  let status = 0;
  let body = '';
  const res = {
    setHeader() {},
    end(s) { body = s; },
  };
  Object.defineProperty(res, 'statusCode', { set(v) { status = v; } });
  await handler({
    method: 'POST',
    headers: {},
    body: { grant_type: 'authorization_code', resource: 'https://evil.example/api' },
  }, res);
  assert.equal(status, 400);
  assert.equal(JSON.parse(body).error, 'invalid_target');
});

test('protected-resource metadata names the Studio connector', async () => {
  const handler = require('../api/oauth-metadata');
  let body = '';
  const res = {
    setHeader() {},
    end(s) { body = s; },
  };
  Object.defineProperty(res, 'statusCode', { set() {} });
  await handler({ method: 'GET', headers: {}, query: { doc: 'resource' } }, res);
  const json = JSON.parse(body);
  assert.equal(json.resource, 'https://algorithmacy.org/api/studio-mcp');
  assert.deepEqual(json.authorization_servers, ['https://algorithmacy.org']);
});
