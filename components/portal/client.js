'use client';

import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailLink,
  isSignInWithEmailLink,
  signOut,
  GoogleAuthProvider,
  GithubAuthProvider,
} from 'firebase/auth';
import { SAMPLE_ID, sampleApi } from '../../assets/js/portal/sample.js';
import { authMessage, plainPortalError } from '../../assets/js/portal/auth-message.js';
import { safeNext } from './format';

export { authMessage, plainPortalError, safeNext, SAMPLE_ID };

let firebaseAuth = null;
let cachedConfig = null;
let previewAccountId = '';

export function setPreviewAccount(id) {
  previewAccountId = id ? String(id) : '';
}

export function previewAccount() {
  return previewAccountId;
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

export async function loadAuth() {
  if (firebaseAuth) return firebaseAuth;
  const cfg = await getConfig();
  if (!cfg.configured) return null;
  const app = getApps()[0] || initializeApp(cfg.firebase);
  firebaseAuth = getAuth(app);
  return firebaseAuth;
}

export async function signInWithGithub() {
  const auth = await loadAuth();
  if (!auth) throw new Error('Sign-in is not open yet. Write to topanga@algorithmacy.org.');
  const provider = new GithubAuthProvider();
  provider.addScope('read:user');
  provider.addScope('user:email');
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GithubAuthProvider.credentialFromResult(result);
    const token = credential && credential.accessToken;
    if (!token) throw new Error('GitHub did not confirm this sign-in. Try again.');
    const idToken = await result.user.getIdToken();
    const res = await fetch('/api/portal/auth/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      try { await signOut(auth); } catch (e) { /* leave the message */ }
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

export async function signInWithGoogle() {
  const auth = await loadAuth();
  if (!auth) throw new Error('Sign-in is not open yet. Write to topanga@algorithmacy.org.');
  await signInWithPopup(auth, new GoogleAuthProvider());
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
  const auth = await loadAuth();
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
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user || null);
    });
  });
}

export async function finishEmailLink() {
  const auth = await loadAuth();
  if (!auth) throw new Error('Sign-in is not open yet.');
  if (!isSignInWithEmailLink(auth, window.location.href)) {
    return { ok: false, message: 'That link is not a sign-in link. Request another.' };
  }
  let email = '';
  try { email = localStorage.getItem('studioEmail') || ''; } catch (e) { /* private mode */ }
  if (!email) email = window.prompt('Email address for this link') || '';
  if (!email) throw new Error('The email address is required to finish signing in.');
  await signInWithEmailLink(auth, email, window.location.href);
  try { localStorage.removeItem('studioEmail'); } catch (e) { /* private mode */ }
  let back = '';
  try {
    back = sessionStorage.getItem('studioOauthReturn') || '';
    sessionStorage.removeItem('studioOauthReturn');
  } catch (e) { /* private mode */ }
  return { ok: true, href: back.indexOf('/oauth/authorize?') === 0 ? back : '/portal/' };
}

export async function signOutUser() {
  storeMfa('');
  try {
    const auth = await loadAuth();
    if (auth) await signOut(auth);
  } catch (e) { /* leave the page either way */ }
  window.location.href = '/portal/login/';
}

export function loginNext() {
  return safeNext(new URLSearchParams(window.location.search).get('next') || '/portal/');
}
