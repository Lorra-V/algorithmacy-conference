import { api, esc, getAuth, authApi, storeMfa } from './api.js';

function grouped(secret) {
  return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
}

function qrSrc(qr) {
  return typeof qr === 'string' && qr.indexOf('data:image/') === 0 ? qr : '';
}

async function signOut() {
  storeMfa('');
  try {
    const auth = await getAuth();
    if (auth) await authApi().signOut(auth);
  } catch (e) { /* leave the page either way */ }
  location.href = '/portal/login/';
}

function clearChrome() {
  const meta = document.getElementById('portal-top-meta');
  if (meta) meta.textContent = '';
  const nav = document.getElementById('portal-nav');
  if (nav) nav.hidden = true;
}

function shell(root, inner) {
  clearChrome();
  root.innerHTML = '<div class="mfa-panel">' + inner + '</div>';
  const button = document.getElementById('mfa-signout');
  if (button) button.addEventListener('click', function () { void signOut(); });
}

function leadFor(me) {
  if (me && me.user && me.user.isAdmin) {
    return 'The sign-in email can be read on a pull request. The link to your inbox is the first check. This code is the second.';
  }
  return 'The link proves the email. This code proves it is you.';
}

function codeForm(title, lead, button) {
  return '<h1>' + esc(title) + '</h1>' +
    '<p class="portal-login-lead">' + esc(lead) + '</p>' +
    '<form class="desk-fields" id="mfa-form">' +
    '<label class="desk-field desk-field-wide"><span>Authenticator code</span>' +
    '<input name="code" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" required></label>' +
    '<div class="desk-field-wide"><button class="btn" type="submit">' + esc(button) + '</button></div>' +
    '<p class="desk-status desk-field-wide" id="mfa-error" hidden></p>' +
    '<div class="desk-field-wide"><button class="btn-quiet" type="button" id="mfa-signout">Sign out</button></div>' +
    '</form>';
}

function showError(err, text) {
  const node = document.getElementById('mfa-error');
  if (!node) return;
  node.hidden = false;
  node.textContent = text || err.message || 'Try again.';
}

function paintSetup(root, me, data) {
  const src = qrSrc(data.qr);
  shell(root,
    '<h1>Set up an authenticator.</h1>' +
    '<p class="portal-login-lead">' + esc(leadFor(me)) + ' Add Algorithmacy in the app, then enter the 6-digit code.</p>' +
    (src ? '<img class="mfa-qr" alt="Authenticator setup code" src="' + esc(src) + '">' : '') +
    '<p class="mfa-secret">' + esc(grouped(data.secret)) + '</p>' +
    '<p class="portal-or">If the app cannot scan the code, type that secret. Account name: Algorithmacy. Email: ' + esc(me.user && me.user.email || '') + '.</p>' +
    '<form class="desk-fields" id="mfa-form">' +
    '<label class="desk-field desk-field-wide"><span>6-digit code</span>' +
    '<input name="code" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9 ]{6,8}"></label>' +
    '<div class="desk-field-wide"><button class="btn" type="submit">Confirm</button></div>' +
    '<p class="desk-status desk-field-wide" id="mfa-error" hidden></p>' +
    '<div class="desk-field-wide"><button class="btn-quiet" type="button" id="mfa-signout">Sign out</button></div>' +
    '</form>'
  );
}

function paintBackup(root, codes) {
  const items = (codes || []).map(function (code) {
    return '<li>' + esc(code) + '</li>';
  }).join('');
  shell(root,
    '<h1>Save these codes.</h1>' +
    '<p class="portal-login-lead">Each code works once, if you do not have the authenticator. They are not shown again. Keep them somewhere that is not your email.</p>' +
    '<ul class="mfa-codes">' + items + '</ul>' +
    '<form class="desk-fields" id="mfa-form">' +
    '<div class="desk-field-wide"><button class="btn" type="submit">I have saved these codes</button></div>' +
    '<div class="desk-field-wide"><button class="btn-quiet" type="button" id="mfa-signout">Sign out</button></div>' +
    '</form>'
  );
}

function paintVerify(root) {
  shell(root, codeForm(
    'Enter your code.',
    'Enter the 6-digit code from your authenticator. A saved backup code works too. If you have lost both, write to roger@algorithmacy.org.',
    'Continue'
  ));
}

export function ensureMfa(root, me) {
  const mode = me && me.mfa === 'verify' ? 'verify' : 'enroll';
  return new Promise(function (resolve) {
    if (mode === 'verify') startVerify(root, resolve);
    else startEnroll(root, me, resolve);
  });
}

function startEnroll(root, me, resolve) {
  shell(root, '<h1>Set up an authenticator.</h1><p class="portal-login-lead">Preparing the setup code.</p>');
  api('mfa/enroll', { method: 'POST', body: {} }).then(function (data) {
    paintSetup(root, me, data);
    document.getElementById('mfa-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      const code = new FormData(event.target).get('code');
      api('mfa/confirm', { method: 'POST', body: { code: code } }).then(function (confirmed) {
        paintBackup(root, confirmed.backupCodes);
        document.getElementById('mfa-form').addEventListener('submit', function (ev) {
          ev.preventDefault();
          storeMfa(confirmed.proof);
          resolve(true);
        });
      }).catch(function (err) {
        button.disabled = false;
        if (err.mfa === 'verify') {
          startVerify(root, resolve);
          return;
        }
        showError(err);
      });
    });
  }).catch(function (err) {
    if (err.mfa === 'verify') {
      startVerify(root, resolve);
      return;
    }
    shell(root,
      '<h1>Set up an authenticator.</h1>' +
      '<p class="desk-status">' + esc(err.message || 'The authenticator could not be prepared.') + '</p>' +
      '<div class="desk-field-wide"><button class="btn-quiet" type="button" id="mfa-signout">Sign out</button></div>'
    );
  });
}

function startVerify(root, resolve) {
  paintVerify(root);
  document.getElementById('mfa-form').addEventListener('submit', function (event) {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    const code = new FormData(event.target).get('code');
    api('mfa/verify', { method: 'POST', body: { code: code } }).then(function (data) {
      storeMfa(data.proof);
      resolve(true);
    }).catch(function (err) {
      button.disabled = false;
      if (err.mfa === 'enroll') {
        startEnroll(root, {}, resolve);
        return;
      }
      showError(err);
    });
  });
}
