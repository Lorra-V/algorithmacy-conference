const { handleBook } = require('../lib/portal/booking');
const { send } = require('../lib/portal/http');

module.exports = async (req, res) => {
  try {
    await handleBook(req, res);
  } catch (e) {
    const status = e.status || (e instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error('studio book', e);
    if (res.writableEnded) return;
    const missing = /Firebase is not configured|FIREBASE|firebase/i.test(String(e.message || ''));
    send(res, missing ? 503 : status, {
      error: missing
        ? 'The calendar is not open yet. Use the form, or write to roger@algorithmacy.org.'
        : (status >= 500 ? 'Something went wrong. Use the form, or write to roger@algorithmacy.org.' : e.message),
    });
  }
};
