// Grant the studioAdmin custom claim on the cursor-boston Firebase project.
//
//   FIREBASE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
//     node scripts/set-studio-admin.js roger@algorithmacy.org
//
// The person must already have signed in once, so the Auth user exists.
// Also set STUDIO_ADMIN_EMAILS on Vercel as a fallback that does not wait
// for the claim to refresh.

const { auth, configured } = require('../lib/portal/firebase-admin');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/set-studio-admin.js <email>');
    process.exit(1);
  }
  if (!configured()) {
    console.error('Set FIREBASE_SERVICE_ACCOUNT_JSON.');
    process.exit(1);
  }
  const user = await auth().getUserByEmail(email);
  const claims = Object.assign({}, user.customClaims, { studioAdmin: true });
  await auth().setCustomUserClaims(user.uid, claims);
  console.log('studioAdmin set for ' + email + ' (' + user.uid + '). They should sign out and back in.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
