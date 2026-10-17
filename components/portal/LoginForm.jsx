'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  authMessage,
  getConfig,
  loginNext,
  signInWithGithub,
  signInWithGoogle,
} from './client';

async function sendLink(address, website, oauthReturn) {
  try { localStorage.setItem('studioEmail', address); } catch (e) { /* private mode */ }
  if (oauthReturn) {
    try { sessionStorage.setItem('studioOauthReturn', window.location.pathname + window.location.search); }
    catch (e) { /* private mode */ }
  }
  const res = await fetch('/api/portal/auth/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: address, website: website || '', next: loginNext() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'We could not send that link. Try again, or write to topanga@algorithmacy.org.');
}

export function LoginForm({
  title,
  lead,
  showBookLink = false,
  oauthReturn = false,
  note = 'If that address was invited, a link is on its way. It works once.',
  onSignedIn,
}) {
  const search = useSearchParams();
  const email = search.get('email') || '';
  const [configured, setConfigured] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    getConfig().then((cfg) => { if (!cancel) setConfigured(!!cfg.configured); }).catch(() => { if (!cancel) setConfigured(false); });
    return () => { cancel = true; };
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const fd = new FormData(event.target);
    const address = String(fd.get('email') || '').trim();
    try {
      await sendLink(address, fd.get('website') || '', oauthReturn);
      setStatus(note);
    } catch (e) {
      setError(authMessage(e, 'We could not send that link. Try again, or write to topanga@algorithmacy.org.'));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError('');
    try {
      await signInWithGoogle();
      if (onSignedIn) await onSignedIn();
      else window.location.href = loginNext();
    } catch (e) {
      setError(authMessage(e, 'Google sign-in did not finish. Use the email link.'));
    }
  }

  async function github() {
    setError('');
    try {
      await signInWithGithub();
      if (onSignedIn) await onSignedIn();
      else window.location.href = loginNext();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <h1>{title}</h1>
      <p className="portal-login-lead">{lead}</p>
      {configured === false ? (
        <p className="desk-status">Sign-in is not open yet. Write to <a href="mailto:topanga@algorithmacy.org">topanga@algorithmacy.org</a>.</p>
      ) : null}
      <form className="desk-fields" onSubmit={onSubmit}>
        <label className="desk-field desk-field-wide">
          <span>Email</span>
          <input type="email" name="email" required autoComplete="email" defaultValue={email} />
        </label>
        <p className="book-hp" hidden>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        </p>
        <div className="desk-field-wide"><button className="btn" type="submit" disabled={busy}>Email me a link</button></div>
        {error ? <p className="desk-status desk-field-wide" role="alert">{error}</p> : null}
        <p className="portal-or desk-field-wide" role="status">{status}</p>
        {configured ? (
          <>
            <div className="desk-field-wide"><button className="btn-quiet" type="button" onClick={google}>Continue with Google</button></div>
            <div className="desk-field-wide"><button className="btn-quiet" type="button" onClick={github}>Continue with GitHub</button></div>
          </>
        ) : null}
        {showBookLink ? (
          <p className="portal-or desk-field-wide">If you're a Studio engineer and don't get a link, sign in with GitHub or contact <a href="mailto:roger@algorithmacy.org">roger@algorithmacy.org</a>.</p>
        ) : null}
      </form>
      {showBookLink ? (
        <p className="portal-or">Booked a call or sent a note, and no invite yet? That is expected. The account is created after the call. <a href="/book/">Book a 20-minute call</a>.</p>
      ) : null}
    </>
  );
}
