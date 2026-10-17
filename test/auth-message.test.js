const test = require('node:test');
const assert = require('node:assert/strict');

test('sign-in errors tell the person what to do', async () => {
  const { authMessage, plainPortalError } = await import('../assets/js/portal/auth-message.js');
  assert.equal(
    authMessage({ code: 'auth/invalid-action-code', message: 'Firebase: Error (auth/invalid-action-code).' }),
    'That link has expired or was already used. Request another from the sign-in page.',
  );
  assert.equal(
    authMessage({ code: 'auth/popup-blocked', message: 'Firebase: Error (auth/popup-blocked).' }),
    'The browser blocked the Google window. Allow popups for this site, or use the email link.',
  );
  assert.equal(
    authMessage({ message: 'Firebase: Error (auth/network-request-failed).' }),
    'The sign-in page could not reach the server. Try again.',
  );
  assert.equal(authMessage(new Error('A valid email is required.')), 'A valid email is required.');
  assert.match(plainPortalError('Firebase is not configured.'), /topanga@algorithmacy.org/);
  assert.equal(plainPortalError('This address is not an engineer yet.'), 'This address is not an engineer yet.');
  assert.doesNotMatch(authMessage({ message: 'Firebase: Error (auth/internal-error).' }), /[Ff]irebase/);
});
