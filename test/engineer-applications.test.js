const test = require('node:test');
const assert = require('node:assert/strict');
const { signInEmail, applicationFromPull } = require('../lib/portal/engineer-applications');

const patch = [
  '@@',
  '+      <div class="person">',
  '+        <img src="/images/speakers/joseph-singh.jpg" alt="Portrait of Joseph Singh">',
  '+          <h3>Joseph Singh</h3>',
  '+          <p>Joseph writes two sentences a client could read.</p>',
].join('\n');

test('a pull request is tied to the GitHub account that opened it', () => {
  const row = applicationFromPull({
    number: 59,
    html_url: 'https://github.com/rogerSuperBuilderAlpha/algorithmacy-conference/pull/59',
    merged_at: null,
    user: { login: 'joes9987' },
    body: 'Adds Joseph Singh.\n\nNo other changes.',
  }, patch);
  assert.equal(row.login, 'joes9987');
  assert.equal(row.name, 'Joseph Singh');
  assert.equal(row.pr, 59);
  assert.equal(row.merged, false);
  assert.equal(row.email, '');
});

test('a sign-in email line is kept and a noreply address is not', () => {
  assert.equal(signInEmail('Sign-in email: joseph@example.com'), 'joseph@example.com');
  assert.equal(signInEmail('Sign-in email: Lorra-V@users.noreply.github.com'), '');
  assert.equal(signInEmail('Sign-in email: cursoragent@cursor.com'), '');
  assert.equal(
    signInEmail('Sign-in email: [justin.raf.jimenez@gmail.com](mailto:justin.raf.jimenez@gmail.com)'),
    'justin.raf.jimenez@gmail.com',
  );
  assert.equal(signInEmail('**Studio login email:** singhjoe57@gmail.com'), 'singhjoe57@gmail.com');
  const row = applicationFromPull({
    number: 60,
    merged_at: '2026-10-13T00:00:00Z',
    user: { login: 'joes9987' },
    body: 'Sign-in email: joseph@example.com',
  }, patch);
  assert.equal(row.email, 'joseph@example.com');
  assert.equal(row.merged, true);
  assert.equal(applicationFromPull({ number: 1, user: { login: 'cursoragent' }, body: '' }, patch), null);
  const human = applicationFromPull({
    number: 58,
    user: { login: 'cursoragent' },
    body: '',
  }, patch, [
    { author: { login: 'cursoragent' }, committer: { login: 'cursoragent' } },
    { author: { login: 'Lorra-V' }, committer: { login: 'cursoragent' } },
  ]);
  assert.equal(human.login, 'Lorra-V');
  assert.equal(human.name, 'Joseph Singh');
});

test('a cursoragent pull request is listed under the human commit author', async () => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';
  const { listEngineerApplications } = require('../lib/portal/engineer-applications');
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const body = url.includes('/pulls?')
      ? [{
        number: 70,
        title: 'Add an engineer',
        body: 'engineer',
        html_url: 'https://github.com/example/pull/70',
        merged_at: '2026-10-01T00:00:00.000Z',
        user: { login: 'cursoragent' },
      }]
      : (url.includes('/commits')
        ? [{ author: { login: 'cursoragent' } }, { author: { login: 'Lorra-V' } }]
        : [{ filename: 'studio/index.html', patch }]);
    return { ok: true, json: async () => body };
  };
  try {
    const rows = await listEngineerApplications(fetcher);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].login, 'Lorra-V');
    assert.equal(calls.some((url) => url.includes('/commits')), true);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }
});
