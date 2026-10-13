const { siteUrl } = require('../lib/portal/http');
const { authorizationServerMetadata, protectedResourceMetadata, cors } = require('../lib/portal/oauth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  const doc = (req.query && req.query.doc) || '';
  const origin = siteUrl();
  const body = doc === 'resource' ? protectedResourceMetadata(origin) : authorizationServerMetadata(origin);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(JSON.stringify(body));
};
