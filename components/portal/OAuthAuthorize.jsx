'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoginForm } from './LoginForm';
import { MfaPanel } from './MfaPanel';
import { api, authMessage, getConfig, loadAuth, waitForUser } from './client';

function problemText(params) {
  if (params.get('response_type') !== 'code') return 'The assistant asked for a response this page does not give.';
  if (!params.get('client_id') || !params.get('redirect_uri') || !params.get('code_challenge')) {
    return 'The assistant left out part of the sign-in request.';
  }
  const method = params.get('code_challenge_method');
  if (method && method !== 'S256') return 'The assistant left out the security check for this connection. Ask it to connect again.';
  const resource = params.get('resource');
  const mine = window.location.origin + '/api/studio-mcp';
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

export default function OAuthAuthorize() {
  const params = useSearchParams();
  const [view, setView] = useState('checking');
  const [message, setMessage] = useState('');
  const [me, setMe] = useState(null);
  const [client, setClient] = useState(null);
  const [error, setError] = useState('');

  async function consent() {
    try {
      let next = await api('me');
      if (next.mfa && next.mfa !== 'ok') {
        setMe(next);
        setView('mfa');
        return;
      }
      const named = await api(
        'oauth/client?client_id=' + encodeURIComponent(params.get('client_id')) +
        '&redirect_uri=' + encodeURIComponent(params.get('redirect_uri'))
      );
      setMe(next);
      setClient(named);
      setView('consent');
    } catch (err) {
      setMessage(authMessage(err, 'Sign-in did not finish. Request another link from this page.'));
      setView('problem');
    }
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      const reason = problemText(params);
      if (reason) {
        if (!cancel) {
          setMessage(reason);
          setView('problem');
        }
        return;
      }
      let cfg;
      try { cfg = await getConfig(); } catch (e) { cfg = { configured: false }; }
      if (!cfg.configured) {
        if (!cancel) {
          setMessage('Sign-in is not open yet. Write to topanga@algorithmacy.org.');
          setView('problem');
        }
        return;
      }
      const auth = await loadAuth();
      const user = auth ? await waitForUser(auth) : null;
      if (cancel) return;
      if (!user) {
        setView('login');
        return;
      }
      await consent();
    })().catch((err) => {
      if (!cancel) {
        setMessage(authMessage(err, 'Sign-in did not finish. Request another link from this page.'));
        setView('problem');
      }
    });
    return () => { cancel = true; };
    // consent reads the current search params once on entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function allow(role) {
    setError('');
    try {
      const data = await api('oauth/consent', {
        method: 'POST',
        body: {
          client_id: params.get('client_id'),
          redirect_uri: params.get('redirect_uri'),
          code_challenge: params.get('code_challenge'),
          code_challenge_method: params.get('code_challenge_method') || 'S256',
          state: params.get('state') || '',
          role,
        },
      });
      if (!data.redirect) throw new Error('Sign-in did not finish. Ask the assistant to connect again.');
      window.location.href = data.redirect;
    } catch (err) {
      setError(authMessage(err, 'This connection did not finish. Ask the assistant to connect again.'));
    }
  }

  if (view === 'checking') {
    return (
      <>
        <h1>Allow an assistant.</h1>
        <p className="portal-login-lead">Checking the request.</p>
      </>
    );
  }
  if (view === 'problem') {
    return (
      <>
        <h1>This connection cannot start.</h1>
        <p className="portal-login-lead">{message}</p>
      </>
    );
  }
  if (view === 'login') {
    return (
      <LoginForm
        title="Sign in to connect an assistant."
        lead="Use the email for your Studio account. An engineer signs in with the invited address. After the link, the portal asks for a code from an authenticator app."
        oauthReturn
        note="If that address was invited, a link is on its way. Open it in this browser. It works once."
        onSignedIn={consent}
      />
    );
  }
  if (view === 'mfa') {
    return <MfaPanel me={me} onDone={consent} />;
  }

  const user = (me && me.user) || {};
  const office = me && me.account && me.account.office;
  const buttons = [];
  if (user.isAdmin) buttons.push(['engineer', 'Allow as an engineer', 'btn']);
  if (office) buttons.push(['client', 'Allow for ' + office, user.isAdmin ? 'btn-quiet' : 'btn']);
  if (!buttons.length) {
    return (
      <>
        <h1>There is nothing to connect.</h1>
        <p className="portal-login-lead">This address is not an engineer yet, and it has no office. An engineer connects after the photo and profile are merged and the Studio owner sends an invite. A client <a href="/book/">books a call</a>, and the account is created after it.</p>
      </>
    );
  }
  return (
    <>
      <h1>Allow {client.clientName}?</h1>
      <p className="portal-login-lead">Signed in as {user.email || ''}. The sign-in code goes only to this address.</p>
      <p className="mfa-secret">{client.redirectUri}</p>
      <p className="portal-or">Continue only if you just asked {client.clientName} to connect. An engineer connection can open every office. An office connection is only that office. Neither one can pay.</p>
      <div className="desk-fields">
        {buttons.map((button) => (
          <div className="desk-field-wide" key={button[0]}>
            <button className={button[2]} type="button" onClick={() => allow(button[0])}>{button[1]}</button>
          </div>
        ))}
        <div className="desk-field-wide"><button className="btn-quiet" type="button" onClick={() => allow('deny')}>Do not allow</button></div>
        {error ? <p className="desk-status desk-field-wide">{error}</p> : null}
      </div>
    </>
  );
}
