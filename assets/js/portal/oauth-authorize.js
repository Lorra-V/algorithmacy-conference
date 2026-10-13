import { getConfig, getAuth, authApi, api, waitForUser, esc, signInWithGithub } from './api.js';
import { authMessage } from './auth-message.js';
import { ensureMfa } from './mfa-ui.js';

const root = document.getElementById('oauth');
const params = new URLSearchParams(location.search);

function show(html) {
  root.innerHTML = html;
}

function problem(text) {
  show('<h1>This connection cannot start.</h1><p class="portal-login-lead">' + esc(text) + '</p>');
}

function requestOk() {
  if (params.get('response_type') !== 'code') return 'The assistant asked for a response this page does not give.';
  if (!params.get('client_id') || !params.get('redirect_uri') || !params.get('code_challenge')) {
    return 'The assistant left out part of the sign-in request.';
  }
  const method = params.get('code_challenge_method');
  if (method && method !== 'S256') return 'The assistant left out the security check for this connection. Ask it to connect again.';
  const resource = params.get('resource');
  const mine = location.origin + '/api/studio-mcp';
  if (resource && resource !== mine) return 'The assistant asked for a different server.';
  let redirect;
  try { redirect = new URL(params.get('redirect_uri')); } catch (e) { return 'The return address is not a URL.'; }
  const host = redirect.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'algorithmacy.org' || host.endsWith('.algorithmacy.org') || host.includes('algorithmacy')) {
    return 'The assistant cannot send the sign-in code to this site, or to an address that pretends to be it.';
  }
  const local = redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1';
  if (redirect.protocol === 'https:' || (redirect.protocol === 'http:' && local)) return '';
  return 'The return address has to be https, or http on your own computer.';
}

async function allow(role) {
  const err = document.getElementById('oauth-error');
  err.hidden = true;
  try {
    const data = await api('oauth/consent', {
      method: 'POST',
      body: {
        client_id: params.get('client_id'),
        redirect_uri: params.get('redirect_uri'),
        code_challenge: params.get('code_challenge'),
        code_challenge_method: params.get('code_challenge_method') || 'S256',
        state: params.get('state') || '',
        role: role,
      },
    });
    if (!data.redirect) throw new Error('Sign-in did not finish. Ask the assistant to connect again.');
    location.href = data.redirect;
  } catch (e) {
    err.hidden = false;
    err.textContent = authMessage(e, 'This connection did not finish. Ask the assistant to connect again.');
  }
}

async function showConsent() {
  let me;
  try {
    me = await api('me');
  } catch (e) {
    problem(authMessage(e, 'Sign-in did not finish. Request another link from this page.'));
    return;
  }
  if (me.mfa && me.mfa !== 'ok') {
    await ensureMfa(root, me);
    try { me = await api('me'); }
    catch (e) {
      problem(authMessage(e, 'Sign-in did not finish. Request another link from this page.'));
      return;
    }
    if (me.mfa && me.mfa !== 'ok') return;
  }
  let client;
  try {
    client = await api(
      'oauth/client?client_id=' + encodeURIComponent(params.get('client_id')) +
      '&redirect_uri=' + encodeURIComponent(params.get('redirect_uri'))
    );
  } catch (e) {
    problem(authMessage(e, 'This application is not registered. Ask the assistant to connect again.'));
    return;
  }
  const user = me.user || {};
  const office = me.account && me.account.office;
  const buttons = [];
  if (user.isAdmin) buttons.push('<button class="btn" type="button" data-role="engineer">Allow as an engineer</button>');
  if (office) buttons.push('<button class="' + (user.isAdmin ? 'btn-quiet' : 'btn') + '" type="button" data-role="client">Allow for ' + esc(office) + '</button>');
  if (!buttons.length) {
    show('<h1>There is nothing to connect.</h1><p class="portal-login-lead">This address is not an engineer yet, and it has no office. An engineer connects after the photo and profile are merged and the Studio owner sends an invite. A client <a href="/book/">books a call</a>, and the account is created after it.</p>');
    return;
  }
  show(
    '<h1>Allow ' + esc(client.clientName) + '?</h1>' +
    '<p class="portal-login-lead">Signed in as ' + esc(user.email || '') + '. The sign-in code goes only to this address.</p>' +
    '<p class="mfa-secret">' + esc(client.redirectUri) + '</p>' +
    '<p class="portal-or">Continue only if you just asked ' + esc(client.clientName) + ' to connect. An engineer connection can open every office. An office connection is only that office. Neither one can pay.</p>' +
    '<div class="desk-fields">' + buttons.map(function (button) {
      return '<div class="desk-field-wide">' + button + '</div>';
    }).join('') +
    '<div class="desk-field-wide"><button class="btn-quiet" type="button" data-role="deny">Do not allow</button></div>' +
    '<p class="desk-status desk-field-wide" id="oauth-error" hidden></p></div>'
  );
  root.querySelectorAll('[data-role]').forEach(function (button) {
    button.addEventListener('click', function () { allow(button.getAttribute('data-role')); });
  });
}

function showLogin() {
  show(
    '<h1>Sign in to connect an assistant.</h1>' +
    '<p class="portal-login-lead">Use the email for your Studio account. An engineer signs in with the invited address. After the link, the portal asks for a code from an authenticator app.</p>' +
    '<form class="desk-fields" id="login-form">' +
    '<label class="desk-field desk-field-wide"><span>Email</span><input type="email" name="email" required autocomplete="email"></label>' +
    '<p class="book-hp" hidden><input name="website" tabindex="-1" autocomplete="off" aria-hidden="true"></p>' +
    '<div class="desk-field-wide"><button class="btn" type="submit">Email me a link</button></div>' +
    '<p class="desk-status desk-field-wide" id="login-error" hidden></p>' +
    '<p class="portal-or desk-field-wide" id="login-note" role="status"></p>' +
    '<div class="desk-field-wide"><button class="btn-quiet" type="button" id="google">Continue with Google</button></div>' +
    '<div class="desk-field-wide"><button class="btn-quiet" type="button" id="github">Continue with GitHub</button></div>' +
    '</form>'
  );
  document.getElementById('login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const err = document.getElementById('login-error');
    err.hidden = true;
    const fd = new FormData(event.target);
    const address = String(fd.get('email') || '').trim();
    localStorage.setItem('studioEmail', address);
    sessionStorage.setItem('studioOauthReturn', location.pathname + location.search);
    try {
      const res = await fetch('/api/portal/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, website: fd.get('website') || '' }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || 'We could not send that link. Try again, or write to roger@algorithmacy.org.');
      document.getElementById('login-note').textContent = 'If that address was invited, a link is on its way. Open it in this browser. It works once.';
    } catch (e) {
      err.hidden = false;
      err.textContent = authMessage(e, 'We could not send that link. Try again, or write to roger@algorithmacy.org.');
    }
  });
  document.getElementById('github').addEventListener('click', async function () {
    const err = document.getElementById('login-error');
    err.hidden = true;
    try {
      await signInWithGithub();
      await showConsent();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
  document.getElementById('google').addEventListener('click', async function () {
    const err = document.getElementById('login-error');
    err.hidden = true;
    try {
      const auth = await getAuth();
      const fns = authApi();
      await fns.signInWithPopup(auth, new fns.GoogleAuthProvider());
      await showConsent();
    } catch (e) {
      err.hidden = false;
      err.textContent = authMessage(e, 'Google sign-in did not finish. Use the email link.');
    }
  });
}

async function start() {
  try {
    const reason = requestOk();
    if (reason) return problem(reason);
    let cfg;
    try { cfg = await getConfig(); } catch (e) { cfg = { configured: false }; }
    if (!cfg.configured) {
      return problem('Sign-in is not open yet. Write to topanga@algorithmacy.org.');
    }
    const auth = await getAuth();
    const user = auth ? await waitForUser(auth) : null;
    if (!user) return showLogin();
    return showConsent();
  } catch (e) {
    problem(authMessage(e, 'Sign-in did not finish. Request another link from this page.'));
  }
}

start();
