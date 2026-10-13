const store = require('../../lib/portal/db');
const core = require('../../lib/submission-core');
const { clientIp, siteUrl } = require('../../lib/portal/http');
const { pkceS256, cors, oauthError, readOauthFields } = require('../../lib/portal/oauth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'POST a token request.');

  let body;
  try {
    body = await readOauthFields(req);
  } catch (e) {
    return oauthError(res, 400, 'invalid_request', 'The token request could not be read.');
  }

  const grant = String(body.grant_type || '');
  if (grant !== 'authorization_code' && grant !== 'refresh_token') {
    return oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  }
  const resource = String(body.resource || '');
  if (resource && resource !== siteUrl() + '/api/studio-mcp') {
    return oauthError(res, 400, 'invalid_target', 'That resource is not this connector.');
  }

  try {
    if (await core.rateLimited({ bucket: 'studio:oauth:token:' + clientIp(req) })) {
      return oauthError(res, 429, 'slow_down', 'Too many token requests. Try again in an hour.');
    }
  } catch (e) {
    console.error('studio oauth token rate-limit', e);
  }

  try {
    if (grant === 'refresh_token') {
      const minted = await store.rotateOauthGrant(body.refresh_token, String(body.client_id || ''));
      if (!minted) return oauthError(res, 400, 'invalid_grant', 'That refresh token is not valid.');
      return tokenResponse(res, minted);
    }

    const code = await store.takeOauthCode(body.code);
    if (!code) return oauthError(res, 400, 'invalid_grant', 'That code is not valid.');
    if (String(body.client_id || '') !== code.clientId) {
      return oauthError(res, 400, 'invalid_grant', 'That code is for a different client.');
    }
    if (String(body.redirect_uri || '') !== code.redirectUri) {
      return oauthError(res, 400, 'invalid_grant', 'That redirect does not match the code.');
    }
    if (!pkceS256(body.code_verifier, code.codeChallenge)) {
      return oauthError(res, 400, 'invalid_grant', 'The code verifier does not match.');
    }
    const minted = await store.issueOauthGrant(code);
    if (!minted) return oauthError(res, 400, 'invalid_grant', 'That sign-in did not pass the authenticator.');
    return tokenResponse(res, minted);
  } catch (e) {
    console.error('studio oauth token', e);
    return oauthError(res, 503, 'server_error', 'Sign-in is not open yet.');
  }
};

function tokenResponse(res, minted) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    access_token: minted.access,
    token_type: 'Bearer',
    expires_in: minted.expiresIn,
    refresh_token: minted.refresh,
    scope: 'studio',
  }));
}
