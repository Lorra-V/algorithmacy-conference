// Create the Studio prices on the Stripe account in STRIPE_SECRET_KEY.
// Prints the ids to put in STRIPE_PRICE_SETUP and STRIPE_PRICE_MONTHLY.
// Safe to re-run: it looks up products by metadata.studio = setup|monthly.

const { stripeClient } = require('../lib/portal/billing');

async function priceFor(stripe, kind, productParams, priceParams) {
  const existing = await stripe.products.search({
    query: `metadata['studio']:'${kind}' AND active:'true'`,
  });
  const product = existing.data[0] || await stripe.products.create({
    ...productParams,
    metadata: { studio: kind },
  });
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
  const price = prices.data.find((p) => p.unit_amount === priceParams.unit_amount && p.currency === 'usd')
    || await stripe.prices.create({ product: product.id, currency: 'usd', ...priceParams });
  return price.id;
}

async function main() {
  const stripe = stripeClient();
  const setup = await priceFor(stripe, 'setup', { name: 'Algorithmacy Studio setup' }, { unit_amount: 500000 });
  const monthly = await priceFor(
    stripe,
    'monthly',
    { name: 'Algorithmacy Studio monthly' },
    { unit_amount: 100000, recurring: { interval: 'month' } },
  );
  console.log('STRIPE_PRICE_SETUP=' + setup);
  console.log('STRIPE_PRICE_MONTHLY=' + monthly);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
