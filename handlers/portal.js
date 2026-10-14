// Portal router. vercel.json rewrites /api/portal/<path> to /api/portal?path=<path>
// so one function serves every authenticated route. api/portal/[...route].js
// is the same router for runtimes that expand a catch-all file themselves.

const { dispatch } = require('../lib/portal/handlers');

module.exports = (req, res) => dispatch(req, res);
