import { SAMPLE_ID, sampleApi } from './sample.js';
import { authMessage, plainPortalError } from './auth-message.js';

const CDN = 'https://www.gstatic.com/firebasejs/12.17.1/';

let firebaseAuth = null;
let authFns = null;
let cachedConfig = null;
let previewAccountId = '';

export function setPreviewAccount(id) {
  previewAccountId = id ? String(id) : '';
}

function previewPath(path) {
  const clean = String(path || '').replace(/^\//, '');
  if (!previewAccountId) return clean;
  if (clean === 'admin' || clean.startsWith('admin/') || clean.startsWith('admin?')) return clean;
  const joiner = clean.indexOf('?') === -1 ? '?' : '&';
  return clean + joiner + 'as=' + encodeURIComponent(previewAccountId);
}

export async function getConfig() {
  if (cachedConfig) return cachedConfig;
  const res = await fetch('/api/portal/config');
  cachedConfig = await res.json().catch(() => ({ configured: false }));
  return cachedConfig;
}

export async function getAuth() {
  if (firebaseAuth) return firebaseAuth;
  const cfg = await getConfig();
  if (!cfg.configured) return null;
  const appMod = await import(CDN + 'firebase-app.js');
  authFns = await import(CDN + 'firebase-auth.js');
  const app = appMod.initializeApp(cfg.firebase);
  firebaseAuth = authFns.getAuth(app);
  return firebaseAuth;
}

export function authApi() {
  return authFns;
}

export async function signInWithGithub() {
  const auth = await getAuth();
  if (!auth) throw new Error('Sign-in is not open yet. Write to topanga@algorithmacy.org.');
  const fns = authApi();
  const provider = new fns.GithubAuthProvider();
  provider.addScope('read:user');
  provider.addScope('user:email');
  try {
    const result = await fns.signInWithPopup(auth, provider);
    const credential = fns.GithubAuthProvider.credentialFromResult(result);
    const token = credential && credential.accessToken;
    if (!token) throw new Error('GitHub did not confirm this sign-in. Try again.');
    const idToken = await result.user.getIdToken();
    const res = await fetch('/api/portal/auth/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      try { await fns.signOut(auth); } catch (e) { /* leave the message */ }
      throw new Error(plainPortalError(data.error || 'This GitHub account could not be connected.'));
    }
    return data;
  } catch (e) {
    if (e && e.code === 'auth/operation-not-allowed') {
      throw new Error('GitHub sign-in is not open yet. Write to roger@algorithmacy.org.');
    }
    throw new Error(authMessage(e, 'GitHub sign-in did not finish. Try again.'));
  }
}

export function storeMfa(token) {
  try {
    if (token) sessionStorage.setItem('studioMfa', token);
    else sessionStorage.removeItem('studioMfa');
  } catch (e) { /* private mode */ }
}

function readMfa() {
  try { return sessionStorage.getItem('studioMfa') || ''; }
  catch (e) { return ''; }
}

export async function api(path, opts) {
  const options = opts || {};
  if (previewAccountId === SAMPLE_ID) return sampleApi(path, options);
  const auth = await getAuth();
  const user = auth && auth.currentUser;
  const token = user ? await user.getIdToken() : '';
  const mfa = readMfa();
  const res = await fetch('/api/portal/' + previewPath(path), {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(mfa ? { 'X-Studio-Mfa': mfa } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(plainPortalError(data.error));
    err.status = res.status;
    if (data.mfa) err.mfa = data.mfa;
    throw err;
  }
  return data;
}

export function waitForUser(auth) {
  return new Promise((resolve) => {
    const stop = authFns.onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user || null);
    });
  });
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function safeNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/portal/') || raw.startsWith('//')) return '/portal/';
  return raw;
}
