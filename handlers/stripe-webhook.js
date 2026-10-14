const { readRaw, send, fail } = require('../lib/portal/http');
const { handleEvent, stripeClient } = require('../lib/portal/billing');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw fail(405, 'Method not allowed.');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw fail(503, 'Billing is not open yet.');
    const raw = await readRaw(req);
    if (!raw.length) throw fail(400, 'Empty body.');
    const stripe = stripeClient();
    let event;
    try {
      event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], secret);
    } catch (e) {
      throw fail(400, 'The signature did not match.');
    }
    const result = await handleEvent(event);
    send(res, 200, result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('studio stripe webhook', e);
    if (!res.writableEnded) send(res, status, { error: status >= 500 ? 'Something went wrong.' : e.message });
  }
};
