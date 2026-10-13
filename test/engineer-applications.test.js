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
  const row = applicationFromPull({
    number: 60,
    merged_at: '2026-10-13T00:00:00Z',
    user: { login: 'joes9987' },
    body: 'Sign-in email: joseph@example.com',
  }, patch);
  assert.equal(row.email, 'joseph@example.com');
  assert.equal(row.merged, true);
  assert.equal(applicationFromPull({ number: 1, user: { login: 'cursoragent' }, body: '' }, patch), null);
});
