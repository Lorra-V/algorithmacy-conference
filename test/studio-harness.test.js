const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const BUTTON = 'Don’t want to read all this? Click here to copy a prompt and paste into any AI tool you use.';

test('the studio page leads with the copy-prompt button', () => {
  const html = read('studio/index.html');
  assert.ok(html.includes(BUTTON), 'exact button copy is missing');
  assert.match(html, /id="copy-studio-prompt"/);
  assert.match(html, /href="\/studio\/llm-harness\.md"/);
  assert.equal(html.includes('—'), false);
  assert.equal(html.includes('&mdash;'), false);
  assert.equal(html.includes('\u2014'), false);
});

test('discovery files exist and parse', () => {
  const harness = read('studio/llm-harness.md');
  const prompt = read('studio/prompt.txt');
  assert.equal(prompt, harness);
  assert.equal(harness.includes('\u2014'), false);
  assert.equal(harness.includes('&mdash;'), false);
  assert.match(harness, /https:\/\/algorithmacy\.org\/studio\/facts\.json/);
  assert.match(harness, /https:\/\/algorithmacy\.org\/studio\/llm-harness\.md/);
  assert.match(harness, /https:\/\/algorithmacy\.org\/llms-full\.txt/);
  assert.match(harness, /Way 1/);
  assert.match(harness, /Way 2/);
  assert.match(harness, /Way 3/);
  assert.match(harness, /first 10/i);
  assert.match(harness, /setting/);
  assert.match(harness, /org/);
  assert.match(harness, /software/);
  assert.match(harness, /users/);
  assert.match(harness, /offer/);
  assert.match(harness, /summary/);

  const facts = JSON.parse(read('studio/facts.json'));
  assert.equal(facts.name, 'Algorithmacy Studio');
  assert.equal(facts.threeWays.length, 3);
  assert.equal(facts.pricing.first10.setupLaborUsd, 0);
  assert.equal(facts.pricing.standard.setupUsd, 5000);
  assert.equal(facts.pricing.standard.maintenanceUsdPerMonth, 1000);
  assert.equal(facts.hardwareTiers[0].retailUsd.low, 2000);
  assert.equal(facts.hardwareTiers[2].retailUsd.high, 9500);
  assert.equal(facts.endpoints.studioMcp.url, 'https://algorithmacy.org/api/studio-mcp');
  const params = facts.booking.parameters.map((item) => item.name);
  for (const name of ['setting', 'org', 'software', 'users', 'offer', 'summary', 'name', 'email', 'notes']) {
    assert.ok(params.includes(name), name);
  }
  const start = harness.indexOf('```json\n') + '```json\n'.length;
  const end = harness.indexOf('\n```', start);
  const embeddedFacts = JSON.parse(harness.slice(start, end));
  assert.deepEqual(embeddedFacts, facts);

  const llms = read('llms.txt');
  for (const url of [
    'https://algorithmacy.org/studio',
    'https://algorithmacy.org/studio/llm-harness.md',
    'https://algorithmacy.org/studio/facts.json',
    'https://algorithmacy.org/llms-full.txt',
    'https://algorithmacy.org/book',
    'https://algorithmacy.org/api/studio-mcp',
  ]) {
    assert.ok(llms.includes(url), url);
  }

  const full = read('llms-full.txt');
  assert.ok(full.includes('Algorithmacy Studio decision guide'));
  assert.ok(full.includes('First 10 installations'));
  assert.ok(full.length > harness.length);

  const robots = read('robots.txt');
  for (const bot of [
    '*', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web',
    'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Googlebot',
    'Bingbot', 'Applebot-Extended', 'CCBot', 'DuckAssistBot', 'cohere-ai',
  ]) {
    assert.match(robots, new RegExp('User-agent: ' + bot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\nAllow: /'));
  }
  assert.match(robots, /Sitemap: https:\/\/algorithmacy\.org\/sitemap\.xml/);

  const sitemap = read('sitemap.xml');
  for (const loc of [
    'https://algorithmacy.org/',
    'https://algorithmacy.org/studio',
    'https://algorithmacy.org/book',
    'https://algorithmacy.org/terms',
    'https://algorithmacy.org/llms.txt',
    'https://algorithmacy.org/llms-full.txt',
    'https://algorithmacy.org/studio/llm-harness.md',
    'https://algorithmacy.org/studio/facts.json',
  ]) {
    assert.ok(sitemap.includes('<loc>' + loc + '</loc>'), loc);
  }

  const agent = JSON.parse(read('.well-known/agent.json'));
  assert.equal(agent.endpoints.facts, 'https://algorithmacy.org/studio/facts.json');
  assert.equal(agent.endpoints.harness, 'https://algorithmacy.org/studio/llm-harness.md');
  assert.equal(agent.endpoints.mcp, 'https://algorithmacy.org/api/studio-mcp');
  assert.equal(agent.endpoints.book, 'https://algorithmacy.org/book');
  JSON.parse(read('.well-known/ai-plugin.json'));
  JSON.parse(read('.well-known/openapi.json'));

  const vercel = JSON.parse(read('vercel.json'));
  const headers = vercel.headers || [];
  for (const source of [
    '/llms.txt', '/llms-full.txt', '/studio/llm-harness.md', '/studio/prompt.txt',
    '/studio/facts.json', '/robots.txt', '/sitemap.xml', '/.well-known/agent.json',
  ]) {
    const rule = headers.find((item) => item.source === source);
    assert.ok(rule, 'missing header rule ' + source);
    const keys = rule.headers.map((item) => item.key + ':' + item.value);
    assert.ok(keys.some((item) => item.startsWith('Content-Type:')), source);
    assert.ok(keys.includes('Access-Control-Allow-Origin:*'), source);
  }
});

test('booking query parameters become form values', async () => {
  const { bookingPrefill } = await import('../assets/js/book-prefill.mjs');
  const got = bookingPrefill('?setting=office&org=Smith+Dental&software=Dentrix&users=12&offer=first-10&summary=Keep%20charts%20local&name=Ada%20Smith&email=ada@smithdental.example&notes=Front%20desk');
  assert.equal(got.setting, 'office');
  assert.equal(got.org, 'Smith Dental');
  assert.equal(got.software, 'Dentrix');
  assert.equal(got.users, '12');
  assert.equal(got.offer, 'first-10');
  assert.equal(got.name, 'Ada Smith');
  assert.equal(got.email, 'ada@smithdental.example');
  assert.match(got.note, /Keep charts local/);
  assert.match(got.note, /Front desk/);
  assert.match(got.note, /Dentrix/);
  assert.match(got.note, /Daily users: 12/);

  const aliases = bookingPrefill('?name=Ada&email=ada@example.com&business=Harbor&note=Intake');
  assert.equal(aliases.org, 'Harbor');
  assert.match(aliases.note, /Intake/);
  assert.equal(bookingPrefill('').any, false);
});

test('studio head points at the harness and the facts', () => {
  const studio = read('studio/index.html');
  const home = read('index.html');
  for (const html of [studio, home]) {
    assert.match(html, /rel="alternate" type="text\/markdown" href="\/studio\/llm-harness\.md"/);
    assert.match(html, /rel="alternate" type="application\/json" href="\/studio\/facts\.json"/);
    assert.match(html, /OfferCatalog/);
    assert.match(html, /FAQPage/);
    assert.match(html, /5000/);
    assert.match(html, /"price": "0"/);
  }
  const blocks = [...studio.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 1);
  for (const block of blocks) JSON.parse(block[1]);
  const homeBlocks = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(homeBlocks.length >= 2);
  for (const block of homeBlocks) JSON.parse(block[1]);
});
