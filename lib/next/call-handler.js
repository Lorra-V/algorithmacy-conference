const { Readable } = require('node:stream');

function queryFrom(url) {
  const query = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (query[key] === undefined) query[key] = value;
    else if (Array.isArray(query[key])) query[key].push(value);
    else query[key] = [query[key], value];
  }
  return query;
}

function headerValue(value) {
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}

// Turns a Web Request into the Node req/res shape the existing api/*.js handlers use.
async function callHandler(handler, request, extras) {
  const url = new URL(request.url);
  const raw = Buffer.from(await request.arrayBuffer());
  const query = queryFrom(url);
  const extra = extras || {};
  if (Array.isArray(extra.route) && extra.route.length) query.route = extra.route;
  if (extra.query) Object.assign(query, extra.query);

  const req = Readable.from(raw.length ? [raw] : []);
  req.method = request.method;
  req.url = url.pathname + url.search;
  req.headers = {};
  request.headers.forEach((value, key) => {
    req.headers[key.toLowerCase()] = value;
  });
  req.query = query;
  req.rawBody = raw;
  req.socket = { remoteAddress: '' };

  const headers = new Map();
  const res = {
    statusCode: 200,
    writableEnded: false,
    _body: null,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), headerValue(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end(payload) {
      if (this.writableEnded) return;
      this.writableEnded = true;
      if (payload == null || payload === '') this._body = null;
      else this._body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
    },
    json(body) {
      if (!this.getHeader('content-type')) {
        this.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      this.end(JSON.stringify(body));
    },
  };

  try {
    await handler(req, res);
  } catch (e) {
    if (!res.writableEnded) {
      const status = e.status || 500;
      res.statusCode = status;
      res.json({ error: status >= 500 ? 'Something went wrong.' : (e.message || 'Something went wrong.') });
    }
  }

  const status = res.statusCode || 200;
  const body = status === 204 || status === 304 ? null : res._body;
  return new Response(body, {
    status,
    headers: Object.fromEntries(headers),
  });
}

module.exports = { callHandler };
