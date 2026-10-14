'use client';

import { useEffect, useState } from 'react';
import { api, signOutUser, storeMfa } from './client';

function grouped(secret) {
  return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
}

function qrSrc(qr) {
  return typeof qr === 'string' && qr.indexOf('data:image/') === 0 ? qr : '';
}

function leadFor(me) {
  if (me && me.user && me.user.isAdmin) {
    return 'The sign-in email can be read on a pull request. The link to your inbox is the first check. This code is the second.';
  }
  return 'The link proves the email. This code proves it is you.';
}

export function MfaPanel({ me, onDone }) {
  const initial = me && me.mfa === 'verify' ? 'verify' : 'enroll';
  const [step, setStep] = useState(initial === 'verify' ? 'verify' : 'loading');
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState([]);
  const [proof, setProof] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial === 'verify') return undefined;
    let cancel = false;
    api('mfa/enroll', { method: 'POST', body: {} }).then((data) => {
      if (cancel) return;
      setSetup(data);
      setStep('setup');
    }).catch((err) => {
      if (cancel) return;
      if (err.mfa === 'verify') {
        setStep('verify');
        return;
      }
      setError(err.message || 'The authenticator could not be prepared.');
      setStep('failed');
    });
    return () => { cancel = true; };
  }, [initial]);

  async function confirm(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const confirmed = await api('mfa/confirm', { method: 'POST', body: { code: new FormData(event.target).get('code') } });
      setCodes(confirmed.backupCodes || []);
      setProof(confirmed.proof || '');
      setStep('backup');
    } catch (err) {
      setBusy(false);
      if (err.mfa === 'verify') {
        setStep('verify');
        return;
      }
      setError(err.message || 'Try again.');
    }
  }

  async function verify(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api('mfa/verify', { method: 'POST', body: { code: new FormData(event.target).get('code') } });
      storeMfa(data.proof);
      onDone();
    } catch (err) {
      setBusy(false);
      if (err.mfa === 'enroll') {
        setStep('loading');
        setError('');
        try {
          const data = await api('mfa/enroll', { method: 'POST', body: {} });
          setSetup(data);
          setStep('setup');
        } catch (enrollErr) {
          setError(enrollErr.message || 'The authenticator could not be prepared.');
          setStep('failed');
        }
        return;
      }
      setError(err.message || 'Try again.');
    }
  }

  function saved(event) {
    event.preventDefault();
    storeMfa(proof);
    onDone();
  }

  return (
    <div className="mfa-panel">
      {step === 'loading' ? (
        <>
          <h1>Set up an authenticator.</h1>
          <p className="portal-login-lead">Preparing the setup code.</p>
        </>
      ) : null}
      {step === 'failed' ? (
        <>
          <h1>Set up an authenticator.</h1>
          <p className="desk-status">{error}</p>
          <div className="desk-field-wide"><button className="btn-quiet" type="button" onClick={signOutUser}>Sign out</button></div>
        </>
      ) : null}
      {step === 'setup' ? (
        <>
          <h1>Set up an authenticator.</h1>
          <p className="portal-login-lead">{leadFor(me)} Add Algorithmacy in the app, then enter the 6-digit code.</p>
          {qrSrc(setup && setup.qr) ? <img className="mfa-qr" alt="Authenticator setup code" src={qrSrc(setup.qr)} /> : null}
          <p className="mfa-secret">{grouped(setup && setup.secret)}</p>
          <p className="portal-or">If the app cannot scan the code, type that secret. Account name: Algorithmacy. Email: {(me.user && me.user.email) || ''}.</p>
          <form className="desk-fields" onSubmit={confirm}>
            <label className="desk-field desk-field-wide">
              <span>6-digit code</span>
              <input name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9 ]{6,8}" />
            </label>
            <div className="desk-field-wide"><button className="btn" type="submit" disabled={busy}>Confirm</button></div>
            {error ? <p className="desk-status desk-field-wide">{error}</p> : null}
            <div className="desk-field-wide"><button className="btn-quiet" type="button" onClick={signOutUser}>Sign out</button></div>
          </form>
        </>
      ) : null}
      {step === 'backup' ? (
        <>
          <h1>Save these codes.</h1>
          <p className="portal-login-lead">Each code works once, if you do not have the authenticator. They are not shown again. Keep them somewhere that is not your email.</p>
          <ul className="mfa-codes">{codes.map((code) => <li key={code}>{code}</li>)}</ul>
          <form className="desk-fields" onSubmit={saved}>
            <div className="desk-field-wide"><button className="btn" type="submit">I have saved these codes</button></div>
            <div className="desk-field-wide"><button className="btn-quiet" type="button" onClick={signOutUser}>Sign out</button></div>
          </form>
        </>
      ) : null}
      {step === 'verify' ? (
        <>
          <h1>Enter your code.</h1>
          <p className="portal-login-lead">Enter the 6-digit code from your authenticator. A saved backup code works too. If you have lost both, write to roger@algorithmacy.org.</p>
          <form className="desk-fields" onSubmit={verify}>
            <label className="desk-field desk-field-wide">
              <span>Authenticator code</span>
              <input name="code" autoComplete="one-time-code" autoCapitalize="off" spellCheck="false" required />
            </label>
            <div className="desk-field-wide"><button className="btn" type="submit" disabled={busy}>Continue</button></div>
            {error ? <p className="desk-status desk-field-wide">{error}</p> : null}
            <div className="desk-field-wide"><button className="btn-quiet" type="button" onClick={signOutUser}>Sign out</button></div>
          </form>
        </>
      ) : null}
    </div>
  );
}
