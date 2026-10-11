const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

function configured() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
}

function adminApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const serviceAccount = JSON.parse(raw);
  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

function db() {
  const app = adminApp();
  if (!app) {
    const err = new Error('Firebase is not configured.');
    err.status = 503;
    throw err;
  }
  return getFirestore(app);
}

function auth() {
  const app = adminApp();
  if (!app) {
    const err = new Error('Firebase is not configured.');
    err.status = 503;
    throw err;
  }
  return getAuth(app);
}

module.exports = { configured, db, auth };
