'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePortal } from './session';
import {
  ConnectionPanel,
  Empty,
  FirstSession,
  Ledger,
  LedgerRow,
  NoAccount,
  PageHead,
} from './ui';
import {
  billingNotStarted,
  byNewest,
  callKind,
  label,
  meetingLabel,
  meetingUpcoming,
  monthLabel,
  nextCallType,
  planPrice,
  statusClass,
  whenLabel,
  zoneName,
} from './format';

function isPreview(me) {
  return !!(me && me.account && me.account.preview);
}

function useLoad(me, load) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    if (!me) return undefined;
    if (!me.account) {
      setState({ loading: false, empty: true });
      return undefined;
    }
    let cancel = false;
    setState({ loading: true });
    Promise.resolve(loadRef.current(me)).then((data) => {
      if (!cancel) setState({ loading: false, data });
    }).catch((err) => {
      if (!cancel) setState({ loading: false, error: err.message || 'Try again.' });
    });
    return () => { cancel = true; };
  }, [me]);
  return state;
}

export function PortalHome() {
  const { me, api } = usePortal();
  const load = useLoad(me, async () => {
    const [log, pending, meetings, reports] = await Promise.all([
      api('activity'),
      api('approvals'),
      api('meetings'),
      api('reports'),
    ]);
    return { log, pending, meetings, reports };
  });
  const sub = 'What needs you now.';
  if (!me || load.loading) return <PageHead title="Home" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Home" sub={sub}><NoAccount me={me} /></PageHead>;
  if (load.error) return <PageHead title="Home" sub={sub}><p className="desk-status">{load.error}</p></PageHead>;

  const agents = load.data.log.agents || [];
  const rows = byNewest(load.data.log.activity || [], 'ts');
  const waiting = (load.data.pending.approvals || []).length;
  const upcoming = (load.data.meetings.meetings || []).filter(meetingUpcoming)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const next = upcoming[0];
  const latest = rows[0];
  const reports = load.data.reports.reports || [];
  const status = me.account.billingStatus || 'none';
  const preview = isPreview(me);
  const pay = !preview && (billingNotStarted(me.account) || status === 'past_due' || status === 'unpaid');

  if (!agents.length) {
    return (
      <PageHead title="Home" sub={sub}>
        {waiting ? (
          <p className="notice">
            {waiting === 1 ? 'One draft is waiting for your approval.' : waiting + ' drafts are waiting for your approval.'}
            {' '}<Link href="/portal/approvals/">Review {waiting === 1 ? 'it' : 'them'}</Link>.
          </p>
        ) : null}
        <FirstSession account={me.account} />
      </PageHead>
    );
  }

  return (
    <PageHead title="Home" sub={sub}>
      <section className="portal-section">
        <h2>Approvals</h2>
        {waiting ? (
          <p className="notice">
            {waiting === 1 ? 'One draft is waiting for your approval.' : waiting + ' drafts are waiting for your approval.'}
            {' '}<Link href="/portal/approvals/">Review {waiting === 1 ? 'it' : 'them'}</Link>.
          </p>
        ) : <p className="role-note">Nothing is waiting for your approval.</p>}
      </section>
      {pay ? (
        <section className="portal-section">
          <h2>Payment</h2>
          <p className="role-note">
            {status === 'past_due' || status === 'unpaid'
              ? 'The card failed. Update it to keep the agents running.'
              : '$6,000 starts the account: $5,000 to set the agents up and $1,000 for the first month.'}
          </p>
          <div className="portal-actions"><Link className="btn" href="/portal/billing/">{status === 'past_due' || status === 'unpaid' ? 'Update payment' : 'Pay $6,000 to start'}</Link></div>
        </section>
      ) : null}
      <section className="portal-section">
        <h2>Next call</h2>
        {next ? (
          <p className="role-note">{callKind(next.type)} on {next.when || whenLabel(next.start)}. <Link href="/portal/meetings/">See the call</Link>.</p>
        ) : (
          <p className="role-note">No call booked. <Link href="/portal/meetings/">Book a call</Link>.</p>
        )}
      </section>
      <section className="portal-section">
        <h2>Latest report</h2>
        {latest ? (
          <p className="role-note">
            {latest.summary}
            {' '}<Link href={'/portal/agents/?agent=' + encodeURIComponent(latest.agentId || '')}>Open the agent</Link>.
          </p>
        ) : <p className="role-note">No reports yet. They appear after your engineer runs an agent.</p>}
      </section>
      {reports.length ? (
        <p className="portal-more"><Link href="/portal/reports/">The monthly report is ready</Link>.</p>
      ) : null}
    </PageHead>
  );
}

export function AgentsHome() {
  const { me, api } = usePortal();
  const requested = useSearchParams().get('agent') || '';
  const load = useLoad(me, async () => api('activity'));
  const sub = 'The agents set up for this office.';
  if (!me || load.loading) return <PageHead title="Agents" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Agents" sub={sub}><NoAccount me={me} /></PageHead>;
  if (load.error) return <PageHead title="Agents" sub={sub}><p className="desk-status">{load.error}</p></PageHead>;

  const agents = load.data.agents || [];
  const rows = byNewest(load.data.activity || [], 'ts');
  const back = <p className="settings-back"><Link href="/portal/agents/">Agents</Link></p>;

  if (requested) {
    const agent = agents.find((item) => item.id === requested);
    if (!agent) return <PageHead title="Agents" sub={sub} before={back}><Empty>That agent is not here.</Empty></PageHead>;
    const mine = rows.filter((row) => row.agentId === agent.id);
    const pause = agent.pauseNote || (agent.status === 'paused' ? 'Paused. It does not post until it is running again.' : '');
    return (
      <PageHead title={agent.name} sub={agent.chore} before={back}>
        <p className="agent-progress"><span className={'status ' + statusClass(agent.status)}>{label(agent.status)}</span></p>
        {pause ? <p className="role-note">{pause}</p> : null}
        <h2>Flow</h2>
        {(agent.steps || []).length
          ? <ol className="engineer-steps">{agent.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          : <Empty>The flow is not written yet.</Empty>}
        <h2>Reports</h2>
        {mine.length ? (
          <Ledger>
            {mine.map((row) => (
              <LedgerRow key={row.id || row.ts + row.summary} when={whenLabel(row.ts)} state={statusClass(row.type)} stateName={label(row.type)}>
                {row.summary}
                {row.detail ? <p className="ledger-detail">{row.detail}</p> : null}
                {row.approvedBy ? <p className="ledger-detail">Signed off by {row.approvedBy}.</p> : null}
              </LedgerRow>
            ))}
          </Ledger>
        ) : <Empty>No reports yet.</Empty>}
        <p className="portal-more"><Link href={'/portal/activity/?agent=' + encodeURIComponent(agent.id)}>Older reports</Link></p>
      </PageHead>
    );
  }

  return (
    <PageHead title="Agents" sub={sub}>
      {agents.length ? (
        <div className="card-grid">
          {agents.map((agent) => (
            <Link className="record piece agent-card" key={agent.id} href={'/portal/agents/?agent=' + encodeURIComponent(agent.id)}>
              <header className="piece-head"><h2>{agent.name}</h2><span className={'status ' + statusClass(agent.status)}>{label(agent.status)}</span></header>
              <p className="clamp">{agent.chore}</p>
            </Link>
          ))}
        </div>
      ) : <FirstSession account={me.account} />}
    </PageHead>
  );
}

export function ActivityPage() {
  const { me, api } = usePortal();
  const initial = useSearchParams();
  const [type, setType] = useState(initial.get('type') || '');
  const [agent, setAgent] = useState(initial.get('agent') || '');
  const [agents, setAgents] = useState([]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const sub = 'Every report, newest first. Filter by what happened or by agent.';

  useEffect(() => {
    if (!me || !me.account) return undefined;
    let cancel = false;
    const q = new URLSearchParams();
    if (type) q.set('type', type);
    if (agent) q.set('agent', agent);
    api('activity' + (q.toString() ? '?' + q.toString() : '')).then((data) => {
      if (cancel) return;
      setAgents(data.agents || []);
      setRows(byNewest(data.activity, 'ts'));
      setError('');
    }).catch((err) => {
      if (!cancel) setError(err.message);
    });
    return () => { cancel = true; };
  }, [me, api, type, agent]);

  if (!me) return <PageHead title="Older reports" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Older reports" sub={sub}><NoAccount me={me} /></PageHead>;
  return (
    <PageHead title="Older reports" sub={sub}>
      <p className="settings-back"><Link href="/portal/agents/">Agents</Link></p>
      <div className="portal-filters">
        <label>Type <select id="filter-type" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">All</option>
          <option value="did">Done</option>
          <option value="needs_approval">Waiting on you</option>
          <option value="blocked">Blocked</option>
          <option value="error">Error</option>
          <option value="note">Note</option>
        </select></label>
        <label>Agent <select id="filter-agent" value={agent} onChange={(event) => setAgent(event.target.value)}>
          <option value="">All</option>
          {agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      </div>
      {error ? <p className="desk-status">{error}</p> : null}
      {rows == null ? <p className="portal-loading">Loading.</p> : (rows.length ? (
        <Ledger>
          {rows.map((row) => (
            <LedgerRow key={row.id || row.ts + row.summary} when={whenLabel(row.ts)} state={statusClass(row.type)} stateName={label(row.type)}>
              {row.summary}
              {row.detail ? <p className="ledger-detail">{row.detail}</p> : null}
              {row.approvedBy ? <p className="ledger-detail">Signed off by {row.approvedBy}.</p> : null}
            </LedgerRow>
          ))}
        </Ledger>
      ) : <Empty>Nothing in this view.</Empty>)}
    </PageHead>
  );
}

export function ApprovalsPage() {
  const { me, api, refresh } = usePortal();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState({});
  const sub = 'A person signs off before a new kind of message goes out.';

  useEffect(() => {
    if (!me || !me.account) return undefined;
    let cancel = false;
    api('approvals').then((data) => {
      if (!cancel) setItems(byNewest(data.approvals, 'createdAt'));
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api, refresh]);

  async function decide(item, decision) {
    setError('');
    setDone((current) => ({ ...current, [item.id]: 'busy' }));
    try {
      await api('approvals', { method: 'POST', body: { id: item.id, decision } });
      setDone((current) => ({ ...current, [item.id]: decision }));
      refresh();
    } catch (err) {
      setDone((current) => ({ ...current, [item.id]: '' }));
      setError(err.message);
    }
  }

  if (!me) return <PageHead title="Approvals" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Approvals" sub={sub}><NoAccount me={me} /></PageHead>;
  const preview = isPreview(me);
  return (
    <PageHead title="Approvals" sub={sub}>
      {preview ? <p className="notice">This is a preview. The client approves or declines on their own sign-in.</p> : null}
      {items == null ? <p className="portal-loading">Loading.</p> : (items.length ? (
        <div id="approvals">
          {items.map((item) => {
            const subject = item.subject || item.summary || 'Draft';
            const why = item.why || 'A person signs off before a new kind of message goes out.';
            const draft = item.draft || item.summary || '';
            const state = done[item.id];
            return (
              <article className="record piece" key={item.id}>
                <header className="piece-head">
                  <h2>{subject}</h2>
                  <span className={state === 'approved' || state === 'declined' ? 'status' : 'status waiting'}>
                    {state === 'approved' ? 'Approved' : (state === 'declined' ? 'Declined' : 'Waiting')}
                  </span>
                </header>
                <p className="ledger-detail">{whenLabel(item.createdAt)}</p>
                <p>{why}</p>
                {draft ? <blockquote className="piece-draft">{draft}</blockquote> : null}
                {state === 'approved' || state === 'declined' ? (
                  <p className="saved">{state === 'approved'
                    ? 'Approved. This kind of message can go out.'
                    : 'Declined. It will not be sent.'}</p>
                ) : preview ? null : (
                  <>
                    <p className="role-note">Approve records your sign-off, so this kind of message can go out. Decline stops this draft. It will not be sent.</p>
                    <div className="portal-actions">
                      <button type="button" className="btn" disabled={state === 'busy'} onClick={() => decide(item, 'approved')}>Approve</button>
                      <button type="button" className="btn-quiet" disabled={state === 'busy'} onClick={() => decide(item, 'declined')}>Decline</button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      ) : <Empty>Nothing is waiting on you.</Empty>)}
      {error ? <p className="desk-status">{error}</p> : null}
    </PageHead>
  );
}

export function RequestsPage() {
  const { me, api } = usePortal();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const sub = 'Ask for a change. The studio answers within one business day.';

  useEffect(() => {
    if (!me || !me.account) return undefined;
    let cancel = false;
    api('requests').then((data) => {
      if (!cancel) setRows(byNewest(data.requests, 'createdAt'));
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api]);

  async function send(event) {
    event.preventDefault();
    setError('');
    setSent('');
    const form = event.target;
    try {
      await api('requests', { method: 'POST', body: { summary: new FormData(form).get('summary') } });
      form.reset();
      setSent('Sent. The studio answers within one business day.');
      const data = await api('requests');
      setRows(byNewest(data.requests, 'createdAt'));
    } catch (err) {
      setError(err.message);
    }
  }

  if (!me) return <PageHead title="Requests" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Requests" sub={sub}><NoAccount me={me} /></PageHead>;
  const preview = isPreview(me);
  return (
    <PageHead title="Requests" sub={sub}>
      {preview ? <p className="notice">This is a preview. The client sends requests on their own sign-in.</p> : (
      <form className="desk-fields" onSubmit={send}>
        <label className="desk-field desk-field-wide">
          <span>What should change</span>
          <input name="summary" required maxLength={500} placeholder="Pause the intake agent on Fridays." />
        </label>
        <div className="desk-field-wide portal-actions"><button className="btn" type="submit">Send</button></div>
        {sent ? <p className="saved desk-field-wide">{sent}</p> : null}
        {error ? <p className="desk-status desk-field-wide">{error}</p> : null}
      </form>
      )}
      <h2>Sent</h2>
      {rows == null ? <p className="portal-loading">Loading.</p> : (rows.length ? (
        <Ledger>
          {rows.map((row) => (
            <LedgerRow key={row.id || row.createdAt + row.summary} when={whenLabel(row.createdAt)} state={statusClass(row.status)} stateName={label(row.status)}>
              {row.summary}
              {row.status === 'open' ? <p className="ledger-detail">Open. The studio picks this up on the next weekday.</p> : null}
            </LedgerRow>
          ))}
        </Ledger>
      ) : <Empty>Nothing sent yet.</Empty>)}
    </PageHead>
  );
}

function Appointment({ meeting, onCancel }) {
  const state = meetingLabel(meeting);
  const when = meeting.when || whenLabel(meeting.start);
  return (
    <article className="record piece">
      <header className="piece-head"><h2>{when}</h2><span className={'status ' + state.cls}>{state.name}</span></header>
      <p>{callKind(meeting.type)} with your engineer.</p>
      {onCancel ? (
        <div className="portal-actions"><button type="button" className="btn-quiet" onClick={() => onCancel(meeting)}>Cancel</button></div>
      ) : null}
    </article>
  );
}

function slotLabel(slot, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(slot.start));
}

export function MeetingsPage() {
  const { me, api, refresh } = usePortal();
  const [meetings, setMeetings] = useState(null);
  const [slots, setSlots] = useState(null);
  const [choice, setChoice] = useState(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!me || !me.account) return;
    const data = await api('meetings');
    const list = data.meetings || [];
    setMeetings(list);
    const closed = me.account.status === 'cancelled';
    const upcoming = list.filter(meetingUpcoming);
    const nextType = closed ? '' : nextCallType(list);
    if (!nextType || (closed && !upcoming.length)) {
      setSlots(null);
      return;
    }
    const open = await api('meetings/slots?type=' + nextType);
    setSlots({ ...open, type: nextType });
  }, [me, api]);

  useEffect(() => {
    if (!me || !me.account) return undefined;
    let cancel = false;
    reload().catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api, reload]);

  async function cancel(meeting) {
    setError('');
    try {
      await api('meetings/cancel', { method: 'POST', body: { id: meeting.id } });
      setChoice(null);
      await reload();
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function book(slot, type) {
    setError('');
    try {
      const held = await api('meetings/hold', { method: 'POST', body: { type, start: slot.start } });
      await api('meetings', { method: 'POST', body: { type, start: slot.start, holdToken: held.holdToken } });
      setChoice(null);
      await reload();
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!me) return <PageHead title="Calls" sub="A time with your engineer."><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Calls" sub="A time with your engineer."><NoAccount me={me} /></PageHead>;
  if (!meetings) return <PageHead title="Calls" sub="A time with your engineer."><p className="portal-loading">Loading.</p></PageHead>;

  const upcoming = meetings.filter(meetingUpcoming).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const past = byNewest(meetings.filter((meeting) => !meetingUpcoming(meeting)), 'start').slice(0, 3);
  const closed = me.account.status === 'cancelled';
  if (closed && !upcoming.length) {
    return <PageHead title="Calls" sub="A time with your engineer."><Empty>This account is closed, so new calls are not open.</Empty></PageHead>;
  }
  const type = slots && slots.type;
  const minutes = (slots && slots.durationMin) || 30;
  const about = type === 'checkpoint'
    ? ' It is the call about a month into the work.'
    : (type === 'monthly' ? ' It is the regular monthly call.' : '');
  const bookedKind = upcoming[0] ? callKind(upcoming[0].type) : '';
  const preview = isPreview(me);
  const title = type ? callKind(type) : (bookedKind || 'Calls');
  const sub = type
    ? minutes + ' minutes with your engineer.' + about
    : (bookedKind ? bookedKind + ' is booked.' : 'A time with your engineer.');

  return (
    <PageHead title={title} sub={sub}>
      {preview ? <p className="notice">This is a preview. The client books and cancels on their own sign-in.</p> : null}
      {upcoming.length ? upcoming.map((meeting) => <Appointment key={meeting.id} meeting={meeting} onCancel={preview ? null : cancel} />) : <p className="portal-empty">No call booked.</p>}
      {!preview && type ? (
        <>
          <h2>Pick a time</h2>
          {choice ? (
            <div className="notice">
              <p>Book {slotLabel(choice, slots.timeZone)} for this {minutes}-minute {callKind(type).toLowerCase()}?</p>
              <div className="portal-actions">
                <button className="btn" type="button" onClick={() => book(choice, type)}>Confirm</button>
                <button className="btn-quiet" type="button" onClick={() => setChoice(null)}>Not this time</button>
              </div>
            </div>
          ) : null}
          {slots.closed ? <Empty>{slots.closed}</Empty> : null}
          {!slots.closed && !(slots.slots || []).length ? <Empty>No open times in the next two weeks.</Empty> : null}
          {!slots.closed && (slots.slots || []).length ? (
            <>
              <p className="role-note">Times are in {zoneName(slots.timeZone)}. Choosing a time asks you to confirm before it is booked.</p>
              <div className="book-times">
                {slots.slots.slice(0, 8).map((slot) => (
                  <button key={slot.start} type="button" className="book-slot" onClick={() => setChoice(slot)}>
                    {slotLabel(slot, slots.timeZone)}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : (!preview && upcoming.length ? <p className="role-note">Another time opens after this call.</p> : null)}
      {error ? <p className="desk-status">{error}</p> : null}
      {past.length ? (
        <>
          <h2>Earlier</h2>
          {past.map((meeting) => <Appointment key={meeting.id} meeting={meeting} />)}
        </>
      ) : null}
    </PageHead>
  );
}

export function BillingPage() {
  const { me, api, refresh } = usePortal();
  const queryStatus = useSearchParams().get('status');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const sub = 'The charge that keeps the agents running.';

  async function go(path, id) {
    setError('');
    setBusy(id);
    try {
      const data = await api(path, { method: 'POST', body: {} });
      if (data.notice) {
        setBusy('');
        setError(data.notice);
        return;
      }
      if (data.sample) {
        refresh();
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setBusy('');
      setError(err.message);
    }
  }

  if (!me) return <PageHead title="Subscription" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Subscription" sub={sub}><NoAccount me={me} /></PageHead>;
  const status = me.account.billingStatus || 'none';
  const active = status === 'active' || status === 'trialing';
  const problem = status === 'past_due' || status === 'unpaid';
  const invoices = me.account.invoices || [];
  const preview = isPreview(me);
  const note = active
    ? 'The monthly charge keeps the agents running. It includes weekday replies, the monthly call, and the written report.'
    : (problem
      ? 'Update the card to keep the agents running.'
      : '$6,000 starts the account: $5,000 to set the agents up and $1,000 for the first month. Every month after that is $1,000.');
  return (
    <PageHead title="Subscription" sub={sub}>
      {queryStatus === 'success' ? <p className="notice">Payment received. The account updates when Stripe confirms it.</p> : null}
      {queryStatus === 'cancel' ? <p className="notice">The payment was not completed.</p> : null}
      <dl className="plan">
        <div><dt>Status</dt><dd>{label(status)}</dd></div>
        <div><dt>Price</dt><dd>{planPrice(status)}</dd></div>
      </dl>
      <p className="bill-note">{note}</p>
      {preview ? <p className="notice">This is a preview. The client pays on their own sign-in.</p> : (
      <div className="portal-actions">
        {active ? (
          <button className="btn" type="button" disabled={busy === 'portal'} onClick={() => go('billing/portal', 'portal')}>Manage subscription</button>
        ) : (problem ? (
          <button className="btn" type="button" disabled={busy === 'portal'} onClick={() => go('billing/portal', 'portal')}>Update payment</button>
        ) : (
          <button className="btn" type="button" disabled={busy === 'pay'} onClick={() => go('billing/checkout', 'pay')}>Pay $6,000 to start</button>
        ))}
      </div>
      )}
      <h2>Invoices</h2>
      {invoices.length ? (
        <Ledger>
          {invoices.map((invoice) => (
            <LedgerRow key={invoice.when + invoice.label} when={whenLabel(invoice.when)} state="" stateName={invoice.status || ''}>
              {invoice.label}. {invoice.amount}.
            </LedgerRow>
          ))}
        </Ledger>
      ) : <Empty>{active ? 'No invoice is on file yet.' : 'No invoice yet. The first one is created when you pay.'}</Empty>}
      {error ? <p className="desk-status">{error}</p> : null}
    </PageHead>
  );
}

export function AccountPage() {
  const { me, api, refresh } = usePortal();
  const [error, setError] = useState('');
  const [inviteError, setInviteError] = useState('');
  const peopleLine = me && me.account
    ? me.account.office + (me.account.kind ? ', ' + me.account.kind : '') + '. Who can open this account, and who gets the weekly note.'
    : 'Who can open this account, and who gets the weekly note.';
  if (!me) return <PageHead title="People" sub={peopleLine}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="People" sub={peopleLine}><NoAccount me={me} /></PageHead>;
  const owner = me.account.role === 'owner';
  const preview = isPreview(me);
  const meMember = (me.account.members || []).find((member) => member.email === me.user.email);
  const receivers = (me.account.members || []).filter((member) => member.digest !== false).map((member) => member.name || member.email);

  async function digest(event) {
    try {
      await api('members/digest', { method: 'POST', body: { digest: event.target.checked } });
    } catch (err) {
      setError(err.message);
    }
  }
  async function remove(email) {
    setError('');
    try {
      await api('members/remove', { method: 'POST', body: { email } });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }
  async function invite(event) {
    event.preventDefault();
    setInviteError('');
    const fd = new FormData(event.target);
    try {
      await api('members', { method: 'POST', body: { name: fd.get('name'), email: fd.get('email') } });
      refresh();
    } catch (err) {
      setInviteError(err.message);
    }
  }

  return (
    <PageHead title="People" sub={peopleLine}>
      {preview ? <p className="notice">This is a preview. The client invites people on their own sign-in.</p> : null}
      <p className="role-note">An owner runs the account. A member can read it and send requests. The weekly note and the monthly report go to {receivers.length ? receivers.join(', ') : 'no one yet'}.</p>
      {(me.account.members || []).length ? (
        <Ledger>
          {me.account.members.map((member) => (
            <LedgerRow key={member.email} when={member.name || member.email} state="" stateName={label(member.role)}>
              {member.email}
              <p className="ledger-detail">
                {member.role === 'owner' ? 'Can invite people, pay the invoice, and remove members.' : 'Can read the portal and send requests.'}
                {' '}
                {member.digest === false ? 'Does not get the weekly note.' : 'Gets the weekly note and the monthly report.'}
              </p>
              {owner && !preview && member.role !== 'owner' ? (
                <div className="portal-actions"><button type="button" className="btn-quiet" onClick={() => remove(member.email)}>Remove</button></div>
              ) : null}
            </LedgerRow>
          ))}
        </Ledger>
      ) : <Empty>No one is on this account yet.</Empty>}
      {meMember && !preview ? (
        <label className="portal-check">
          <input type="checkbox" defaultChecked={meMember.digest !== false} onChange={digest} /> Email me the weekly note and the monthly report
        </label>
      ) : null}
      {!preview && owner ? (
        <>
          <h2>Invite someone at the firm</h2>
          <p className="role-note">They get a link to this portal. They do not get billing access unless they are an owner.</p>
          <form className="desk-fields" onSubmit={invite}>
            <label className="desk-field"><span>Name</span><input name="name" /></label>
            <label className="desk-field"><span>Email</span><input type="email" name="email" required /></label>
            <div className="desk-field-wide portal-actions"><button className="btn" type="submit">Send invite</button></div>
            {inviteError ? <p className="desk-status desk-field-wide">{inviteError}</p> : null}
          </form>
        </>
      ) : null}
      {error ? <p className="desk-status">{error}</p> : null}
    </PageHead>
  );
}

export function SettingsPage() {
  const { me } = usePortal();
  const sub = 'Allow an assistant for this office. It can see what you can see here. It cannot pay, and it cannot open another office.';
  if (!me) return <PageHead title="Connect an assistant" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Connect an assistant" sub={sub}><NoAccount me={me} /></PageHead>;
  if (isPreview(me)) {
    return <PageHead title="Connect an assistant" sub={sub}><p className="notice">This is a preview. The client connects an assistant on their own sign-in.</p></PageHead>;
  }
  return (
    <PageHead title="Connect an assistant" sub={sub}>
      <ConnectionPanel lead="Claude, Cursor, Grok, Muse, or OpenClaw. When it asks you to sign in, allow it for this office." />
    </PageHead>
  );
}

export function ReportsPage() {
  const { me, api } = usePortal();
  const month = useSearchParams().get('month') || '';
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');
  const sub = 'Written from the reports your engineer posted.';

  useEffect(() => {
    if (!me || !me.account) return undefined;
    let cancel = false;
    api('reports').then((data) => {
      if (!cancel) setReports(data.reports || []);
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api]);

  if (!me) return <PageHead title="Monthly report" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Monthly report" sub={sub}><NoAccount me={me} /></PageHead>;
  if (error) return <PageHead title="Monthly report" sub={sub}><p className="desk-status">{error}</p></PageHead>;
  if (!reports) return <PageHead title="Monthly report" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  const current = reports.find((report) => report.month === month) || reports[0];
  if (!reports.length) {
    return <PageHead title="Monthly report" sub={sub}><Empty>No report yet. The first one is written at the start of the next month.</Empty></PageHead>;
  }
  const counts = current && current.counts;
  return (
    <PageHead title="Monthly report" sub={sub}>
      <div className="book-days">
        {reports.map((report) => {
          const on = current && report.month === current.month;
          return (
            <Link
              key={report.month}
              className={'book-slot' + (on ? ' is-on' : '')}
              href={'/portal/reports/?month=' + report.month}
              aria-current={on ? 'page' : undefined}
            >
              {monthLabel(report.month)}{report.soFar ? ' so far' : ''}
            </Link>
          );
        })}
      </div>
      {current ? (
        <>
          <h2>{monthLabel(current.month)}{current.soFar ? ', so far' : ''}</h2>
          {counts ? (
            <ul className="figures">
              <li><span className="fig">{current.total || 0}</span><p>Updates. <Link href="/portal/activity/">Activity</Link></p></li>
              <li><span className="fig">{counts.did || 0}</span><p>Done.</p></li>
              <li><span className="fig">{counts.waiting || 0}</span><p>Waiting on you.</p></li>
              <li><span className="fig">{(counts.blocked || 0) + (counts.note || 0)}</span><p>Blocked or noted.</p></li>
            </ul>
          ) : <p className="role-note">{(current && current.total) || 0} updates. <Link href="/portal/activity/">Activity</Link></p>}
          {(current.highlights || []).length ? (
            <ul className="posture">{current.highlights.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : null}
        </>
      ) : <Empty>No report yet. The first one is written at the start of the next month.</Empty>}
    </PageHead>
  );
}
