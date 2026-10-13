const AUTH_MESSAGES = {
  'auth/popup-blocked': 'The browser blocked the Google window. Allow popups for this site, or use the email link.',
  'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
  'auth/cancelled-popup-request': 'Google sign-in was closed before it finished.',
  'auth/invalid-action-code': 'That link has expired or was already used. Request another from the sign-in page.',
  'auth/expired-action-code': 'That link has expired or was already used. Request another from the sign-in page.',
  'auth/invalid-email': 'Use the email the invite went to.',
  'auth/missing-email': 'Use the email the invite went to.',
  'auth/user-disabled': 'This sign-in is turned off. Write to roger@algorithmacy.org.',
  'auth/network-request-failed': 'The sign-in page could not reach the server. Try again.',
  'auth/unauthorized-domain': 'Sign-in is not open on this address. Open algorithmacy.org and request the link again.',
  'auth/operation-not-allowed': 'Google sign-in is not open. Use the email link.',
  'auth/account-exists-with-different-credential': 'That email already signs in with the email link. Use that.',
  'auth/credential-already-in-use': 'That email already signs in with the email link. Use that.',
  'auth/email-already-in-use': 'That email already signs in with the email link. Use that.',
  'auth/invalid-credential': 'Sign-in did not finish. Request another link from the sign-in page.',
  'auth/user-not-found': 'Sign-in did not finish. Use the email the invite went to.',
  'auth/wrong-password': 'Sign-in did not finish. Use the email link.',
  'auth/too-many-requests': 'Too many attempts. Wait an hour, then request another link.',
  'auth/web-storage-unsupported': 'This browser is blocking sign-in. Allow cookies for this site, or try another browser.',
  'auth/internal-error': 'Sign-in did not finish. Request another link from the sign-in page.',
  'auth/argument-error': 'That link is not a sign-in link. Request another from the sign-in page.',
};

const FALLBACK = 'Sign-in did not finish. Request another link from the sign-in page.';

function looksTechnical(text) {
  return /firebase|auth\/|PERMISSION_DENIED|service account|ECONNREFUSED/i.test(String(text || ''));
}

export function authMessage(error, fallback) {
  const code = error && (error.code || '');
  if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  const raw = error && error.message ? String(error.message) : '';
  const fromCode = String(code).match(/auth\/[a-z0-9-]+/i);
  if (fromCode && AUTH_MESSAGES[fromCode[0]]) return AUTH_MESSAGES[fromCode[0]];
  const fromText = raw.match(/auth\/[a-z0-9-]+/i);
  if (fromText && AUTH_MESSAGES[fromText[0]]) return AUTH_MESSAGES[fromText[0]];
  if (looksTechnical(raw) || looksTechnical(code)) return fallback || FALLBACK;
  if (raw) return raw;
  return fallback || FALLBACK;
}

export function plainPortalError(text) {
  const raw = String(text || '');
  if (!raw || looksTechnical(raw)) return 'Something went wrong. Try again, or write to roger@algorithmacy.org.';
  return raw;
}
