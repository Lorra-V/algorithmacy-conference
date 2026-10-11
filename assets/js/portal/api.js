const CDN = 'https://www.gstatic.com/firebasejs/12.17.1/';

let firebaseAuth = null;
let authFns = null;
let cachedConfig = null;

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

export async function api(path, opts) {
  const options = opts || {};
  const auth = await getAuth();
  const user = auth && auth.currentUser;
  const token = user ? await user.getIdToken() : '';
  const res = await fetch('/api/portal/' + path.replace(/^\//, ''), {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.status = res.status;
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
