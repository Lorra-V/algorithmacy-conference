const store = require('../../lib/portal/db');
const core = require('../../lib/submission-core');
const { clientIp } = require('../../lib/portal/http');
const { safeRedirectUri, cors, oauthError, readOauthFields } = require('../../lib/portal/oauth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'POST a client registration.');

  let body;
  try {
    body = await readOauthFields(req);
  } catch (e) {
    return oauthError(res, 400, 'invalid_request', 'The registration could not be read.');
  }

  const method = body.token_endpoint_auth_method || 'none';
  if (method !== 'none') {
    return oauthError(res, 400, 'invalid_client_metadata', 'This server only accepts public clients. Use token_endpoint_auth_method none and PKCE.');
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  const redirectUris = uris.filter(safeRedirectUri).slice(0, 5);
  if (!redirectUris.length) {
    return oauthError(res, 400, 'invalid_redirect_uri', 'A redirect must be https on an allowed assistant, or http on localhost.');
  }

  try {
    await core.enforceRate({
      bucket: 'studio:oauth:register:' + clientIp(req),
      message: 'Too many registrations. Try again in an hour.',
    });
  } catch (e) {
    if (e.status === 429) return oauthError(res, 429, 'slow_down', e.message);
    console.error('studio oauth register rate-limit', e);
    return oauthError(res, 503, 'server_error', 'Registration is not available right now.');
  }

  try {
    const client = await store.registerOauthClient({
      clientName: body.client_name,
      redirectUris,
    });
    res.statusCode = 201;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({
      client_id: client.clientId,
      client_name: client.clientName,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'studio',
    }));
  } catch (e) {
    console.error('studio oauth register', e);
    return oauthError(res, 503, 'server_error', 'Registration is not open yet.');
  }
};
