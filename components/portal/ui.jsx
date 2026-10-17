'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { billingNotStarted } from './format';
import { usePortal } from './session';

export function StudioStyles() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400..600;1,8..60,400..600&family=Inter:wght@400;500;600&display=swap" />
      <link rel="stylesheet" href="/assets/css/studio.css" />
      <link rel="stylesheet" href="/assets/css/portal.css" />
    </>
  );
}

export function Empty({ children }) {
  return <p className="portal-empty">{children}</p>;
}

export function Ledger({ heads, children }) {
  return (
    <figure className="record ledger">
      <table>
        {heads && heads.length ? (
          <thead>
            <tr>{heads.map((head) => <th key={head}>{head}</th>)}</tr>
          </thead>
        ) : null}
        <tbody>{children}</tbody>
      </table>
    </figure>
  );
}

export function LedgerRow({ when, state, stateName, children }) {
  return (
    <tr>
      <th>{when}</th>
      <td className={'status ' + (state || '')}>{stateName}</td>
      <td>{children}</td>
    </tr>
  );
}

export function PageHead({ title, sub, before, children }) {
  useEffect(() => {
    if (title) document.title = title + ' · Algorithmacy Studio';
  }, [title]);
  return (
    <>
      {before}
      <header className="page-head">
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </header>
      <div id="portal-main">{children}</div>
    </>
  );
}

export function Tabs({ label, tabs }) {
  const [index, setIndex] = useState(0);
  function move(event, i) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
    setIndex(next);
    const list = event.currentTarget.parentElement;
    const buttons = list ? list.querySelectorAll('[role="tab"]') : [];
    if (buttons[next]) buttons[next].focus();
  }
  return (
    <>
      <div className="portal-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tab.id}
            aria-selected={i === index}
            aria-controls={tab.panel}
            tabIndex={i === index ? 0 : -1}
            onClick={() => setIndex(i)}
            onKeyDown={(event) => move(event, i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.panel} id={tab.panel} role="tabpanel" aria-labelledby={tab.id} hidden={i !== index}>
          {tab.children}
        </div>
      ))}
    </>
  );
}

export function NoAccount({ me }) {
  const { openSample } = usePortal();
  if (me && me.user && me.user.isAdmin) {
    return (
      <>
        <Empty>Open Harbor &amp; Finch to walk through the sample office.</Empty>
        <div className="portal-actions">
          <button type="button" className="btn" onClick={openSample}>Open Harbor &amp; Finch</button>
        </div>
      </>
    );
  }
  if (me && me.user && me.user.google) {
    return (
      <>
        <Empty>This Google address has no Studio account yet. An engineer signs in with the email the invite was sent to. A client books a call, and the account is created after it.</Empty>
        <div className="portal-actions"><a className="btn" href="/book/">Book a 20-minute call</a></div>
      </>
    );
  }
  return (
    <>
      <Empty>No account for this address yet. Book a call, and we will invite you after it.</Empty>
      <div className="portal-actions"><a className="btn" href="/book/">Book a 20-minute call</a></div>
    </>
  );
}

export function FirstSession({ account }) {
  return (
    <ol className="engineer-steps">
      {billingNotStarted(account) ? (
        <li>Pay on <Link href="/portal/billing/">Subscription</Link>. $6,000 starts the account: $5,000 to set the agents up and $1,000 for the first month.</li>
      ) : null}
      <li>Invite the people who should see the record, on <Link href="/portal/account/">People</Link>.</li>
      <li>Agents and reports appear here after your engineer sets them up.</li>
    </ol>
  );
}

export function ConnectionPanel({ lead }) {
  const [url, setUrl] = useState('https://algorithmacy.org/api/studio-mcp');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setUrl(window.location.origin + '/api/studio-mcp');
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch (e) {
      setCopied(false);
    }
  }
  return (
    <section className="portal-section">
      <h2>Connect an assistant</h2>
      <p className="role-note">{lead}</p>
      <p className="key-once">{url}</p>
      <div className="portal-actions"><button type="button" className="btn-quiet" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
      <p className="role-note">Paste that URL into Claude, Cursor, Grok, Muse, or OpenClaw. It will ask you to sign in. There is no key to copy.</p>
    </section>
  );
}

export function Status({ className, children }) {
  return <p className={className || 'desk-status'}>{children}</p>;
}
