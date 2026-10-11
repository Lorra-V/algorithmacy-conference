const store = require('./db');
const { fail, siteUrl } = require('./http');

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw fail(503, 'Billing is not open yet. Write to roger@algorithmacy.org.');
  const Stripe = require('stripe');
  return new Stripe(key);
}

function priceIds() {
  const setup = process.env.STRIPE_PRICE_SETUP;
  const monthly = process.env.STRIPE_PRICE_MONTHLY;
  if (!setup || !monthly) throw fail(503, 'Billing is not open yet. Write to roger@algorithmacy.org.');
  return { setup, monthly };
}

async function checkout(account, email) {
  const stripe = stripeClient();
  const prices = priceIds();
  let customerId = account.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      name: account.office,
      metadata: { accountId: account.id },
    });
    customerId = customer.id;
    await store.setBilling(account.id, { stripeCustomerId: customerId });
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [
      { price: prices.monthly, quantity: 1 },
      { price: prices.setup, quantity: 1 },
    ],
    success_url: siteUrl() + '/portal/billing/?status=success',
    cancel_url: siteUrl() + '/portal/billing/?status=cancel',
    metadata: { accountId: account.id },
    subscription_data: { metadata: { accountId: account.id } },
  });
  return { url: session.url };
}

async function portal(account) {
  if (!account.stripeCustomerId) throw fail(400, 'There is no billing record yet.');
  const stripe = stripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: siteUrl() + '/portal/billing/',
  });
  return { url: session.url };
}

async function applySubscription(accountId, subscription, customerId) {
  const status = subscription.status;
  const patch = {
    stripeSubscriptionId: subscription.id,
    billingStatus: status,
  };
  if (customerId) patch.stripeCustomerId = customerId;
  if (status === 'active' || status === 'trialing') {
    const acc = await store.accountById(accountId);
    if (acc && (acc.status === 'invited' || acc.status === 'paused')) patch.status = 'active';
  }
  if (status === 'canceled') patch.status = 'cancelled';
  await store.setBilling(accountId, patch);
}

async function handleEvent(event) {
  const seen = await store.stripeEvents().doc(event.id).get();
  if (seen.exists) return { duplicate: true };
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const accountId = session.metadata && session.metadata.accountId;
    if (accountId) {
      await store.setBilling(accountId, {
        stripeCustomerId: session.customer || '',
        stripeSubscriptionId: session.subscription || '',
        billingStatus: 'active',
        status: 'active',
      });
    }
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const accountId = (subscription.metadata && subscription.metadata.accountId) || '';
    let id = accountId;
    if (!id && subscription.customer) {
      const acc = await store.accountByCustomer(subscription.customer);
      if (acc) id = acc.id;
    }
    if (id) {
      if (event.type === 'customer.subscription.deleted') {
        await store.setBilling(id, { billingStatus: 'canceled', status: 'cancelled', stripeSubscriptionId: subscription.id });
      } else {
        await applySubscription(id, subscription, subscription.customer);
      }
    }
  }
  await store.stripeEvents().doc(event.id).set({ type: event.type, at: new Date().toISOString() });
  return { ok: true };
}

module.exports = { checkout, portal, handleEvent, stripeClient };
