'use client';

import { useEffect, useState } from 'react';
import { authMessage, finishEmailLink } from '../../../../components/portal/client';

export default function FinishPage() {
  const [note, setNote] = useState('Checking the link.');
  useEffect(() => {
    let cancel = false;
    finishEmailLink().then((result) => {
      if (cancel) return;
      if (!result.ok) {
        setNote(result.message);
        return;
      }
      window.location.replace(result.href);
    }).catch((err) => {
      if (!cancel) setNote(authMessage(err, 'That link did not work. Request another from the sign-in page.'));
    });
    return () => { cancel = true; };
  }, []);
  return (
    <header className="page-head">
      <h1>Signing in.</h1>
      <p id="finish-note">{note}</p>
    </header>
  );
}
