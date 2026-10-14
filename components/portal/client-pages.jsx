'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { usePortal } from './session';
import {
  ConnectionPanel,
  Empty,
  FirstSession,
  Ledger,
  LedgerRow,
  NoAccount,
  PageHead,
  Tabs,
} from './ui';
import {
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

export function AgentsHome() {
  const { me, api } = usePortal();
  const pathname = usePathname();
  const requested = useSearchParams().get('agent') || '';
  const load = useLoad(me, async () => {
    const [log, pending] = await Promise.all([api('activity'), api('approvals')]);
    return { log, pending };
  });
  const sub = 'What is set up for your office, and the reports your engineer posts after each run.';
  if (!me || load.loading) return <PageHead title="Agents" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Agents" sub={sub}><NoAccount me={me} /></PageHead>;
  if (load.error) return <PageHead title="Agents" sub={sub}><p className="desk-status">{load.error}</p></PageHead>;

  const agents = load.data.log.agents || [];
  const rows = byNewest(load.data.log.activity || [], 'ts');
  const pending = (load.data.pending.approvals || []).length;
  const back = <p className="settings-back"><Link href={pathname}>Agents</Link></p>;

  if (requested) {
    const agent = agents.find((item) => item.id === requested);
    if (!agent) return <PageHead title="Agents" sub={sub} before={back}><Empty>That agent is not here.</Empty></PageHead>;
    const mine = rows.filter((row) => row.agentId === agent.id);
    const pause = agent.pauseNote || (agent.status === 'paused' ? 'Paused. It does not post until it is running again.' : '');
    return (
      <PageHead title={agent.name} sub={agent.chore} before={back}>
        <Tabs label={agent.name} tabs={[
          {
            id: 'tab-progress',
            panel: 'panel-progress',
            label: 'Progress',
            children: (
              <>
                <p className="agent-progress"><span className={'status ' + statusClass(agent.status)}>{label(agent.status)}</span></p>
                {pause ? <p className="role-note">{pause}</p> : null}
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
              </>
            ),
          },
          {
            id: 'tab-flow',
            panel: 'panel-flow',
            label: 'Flow',
            children: (agent.steps || []).length
              ? <ol className="engineer-steps">{agent.steps.map((step) => <li key={step}>{step}</li>)}</ol>
              : <Empty>The flow is not written yet.</Empty>,
          },
        ]} />
      </PageHead>
    );
  }

  const notice = pending === 1
    ? <p className="notice">One draft is waiting for your approval. <Link href="/portal/approvals/">Review it</Link>.</p>
    : (pending > 1 ? <p className="notice">{pending} drafts are waiting for your approval. <Link href="/portal/approvals/">Review them</Link>.</p> : null);

  return (
    <PageHead title="Agents" sub={sub}>
      {notice}
      <Tabs label="Agents and reports" tabs={[
        {
          id: 'tab-agents',
          panel: 'panel-agents',
          label: 'Agents',
          children: agents.length ? (
            <div className="card-grid">
              {agents.map((agent) => (
                <Link className="record piece agent-card" key={agent.id} href={pathname + '?agent=' + encodeURIComponent(agent.id)}>
                  <header className="piece-head"><h2>{agent.name}</h2><span className={'status ' + statusClass(agent.status)}>{label(agent.status)}</span></header>
                  <p className="clamp">{agent.chore}</p>
                </Link>
              ))}
            </div>
          ) : <FirstSession account={me.account} />,
        },
        {
          id: 'tab-reports',
          panel: 'panel-reports',
          label: 'Reports',
          children: (
            <>
              <p className="role-note">Your engineer posts a report from Claude or Cursor after a run.</p>
              {rows.length ? (
                <div className="card-grid">
                  {rows.map((row) => {
                    const name = (agents.find((agent) => agent.id === row.agentId) || {}).name;
                    const meta = [whenLabel(row.ts), name || 'Your engineer'].filter(Boolean).join(' · ');
                    return (
                      <article className="record piece" key={row.id || row.ts + row.summary}>
                        <header className="piece-head">
                          <p className="piece-meta">{meta}</p>
                          {row.type && row.type !== 'did' ? <span className={'status ' + statusClass(row.type)}>{label(row.type)}</span> : null}
                        </header>
                        <p className="clamp">{row.summary}</p>
                      </article>
                    );
                  })}
                </div>
              ) : <Empty>No reports yet.</Empty>}
              {rows.length >= 50 ? <p className="portal-more"><Link href="/portal/activity/">Older reports</Link></p> : null}
            </>
          ),
        },
      ]} />
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
  const sub = 'Newest first. What the agents did, and who signed off.';

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

  if (!me) return <PageHead title="Activity" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Activity" sub={sub}><NoAccount me={me} /></PageHead>;
  return (
    <PageHead title="Activity" sub={sub}>
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
  const sub = 'Read the draft, then approve it or decline it. The decision stays on this page.';

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
    } catch (err) {
      setDone((current) => ({ ...current, [item.id]: '' }));
      setError(err.message);
    }
  }

  if (!me) return <PageHead title="Approvals" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Approvals" sub={sub}><NoAccount me={me} /></PageHead>;
  return (
    <PageHead title="Approvals" sub={sub}>
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
                    ? 'Approved. It is in the activity log. It will not send until that kind of message is allowed.'
                    : 'Declined. It will not be sent.'}</p>
                ) : (
                  <div className="portal-actions">
                    <button type="button" className="btn" disabled={state === 'busy'} onClick={() => decide(item, 'approved')}>Approve</button>
                    <button type="button" className="btn-quiet" disabled={state === 'busy'} onClick={() => decide(item, 'declined')}>Decline</button>
                  </div>
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
  const { me, api, refresh } = usePortal();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const sub = 'The studio reads a request on weekdays and answers within one business day.';

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
    try {
      await api('requests', { method: 'POST', body: { summary: new FormData(event.target).get('summary') } });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!me) return <PageHead title="Requests" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Requests" sub={sub}><NoAccount me={me} /></PageHead>;
  return (
    <PageHead title="Requests" sub={sub}>
      <form className="desk-fields" onSubmit={send}>
        <label className="desk-field desk-field-wide">
          <span>The change</span>
          <input name="summary" required maxLength={500} placeholder="Ask Chase to follow Hale on Tuesdays only." />
        </label>
        <div className="desk-field-wide portal-actions"><button className="btn" type="submit">Send</button></div>
        {error ? <p className="desk-status desk-field-wide">{error}</p> : null}
      </form>
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

export function MeetingsPage() {
  const { me, api, refresh } = usePortal();
  const [meetings, setMeetings] = useState(null);
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  const sub = 'A time with your AI engineer.';

  useEffect(() => {
    if (!me || !me.account) return undefined;
    let cancel = false;
    api('meetings').then(async (data) => {
      if (cancel) return;
      const list = data.meetings || [];
      setMeetings(list);
      const closed = me.account.status === 'cancelled';
      const upcoming = list.filter(meetingUpcoming);
      const type = closed ? '' : nextCallType(list);
      if (!type || (closed && !upcoming.length)) {
        setSlots(null);
        return;
      }
      try {
        const open = await api('meetings/slots?type=' + type);
        if (!cancel) setSlots({ ...open, type });
      } catch (err) {
        if (!cancel) setError(err.message);
      }
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api]);

  async function cancel(meeting) {
    setError('');
    try {
      await api('meetings/cancel', { method: 'POST', body: { id: meeting.id } });
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
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!me) return <PageHead title="Book a call" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Book a call" sub={sub}><NoAccount me={me} /></PageHead>;
  if (!meetings) return <PageHead title="Book a call" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;

  const upcoming = meetings.filter(meetingUpcoming).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const past = byNewest(meetings.filter((meeting) => !meetingUpcoming(meeting)), 'start').slice(0, 3);
  const closed = me.account.status === 'cancelled';
  if (closed && !upcoming.length) {
    return <PageHead title="Book a call" sub={sub}><Empty>This account is closed, so new calls are not open.</Empty></PageHead>;
  }
  const type = slots && slots.type;
  const intro = type === 'checkpoint'
    ? 'Pick a time for the check-in. It is the call about a month into the work.'
    : (type === 'monthly' ? 'Pick a time for the monthly call.' : '');

  return (
    <PageHead title="Book a call" sub={sub}>
      {upcoming.length ? upcoming.map((meeting) => <Appointment key={meeting.id} meeting={meeting} onCancel={cancel} />) : <p className="portal-empty">No call booked.</p>}
      {type ? (
        <>
          <h2>Pick a time</h2>
          <p className="role-note">{intro}</p>
          {slots.closed ? <Empty>{slots.closed}</Empty> : null}
          {!slots.closed && !(slots.slots || []).length ? <Empty>No open times in the next two weeks.</Empty> : null}
          {!slots.closed && (slots.slots || []).length ? (
            <>
              <p className="role-note">Times are in {zoneName(slots.timeZone)}.</p>
              <div className="book-times">
                {slots.slots.slice(0, 8).map((slot) => (
                  <button key={slot.start} type="button" className="book-slot" onClick={() => book(slot, type)}>
                    {new Intl.DateTimeFormat('en-US', {
                      timeZone: slots.timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    }).format(new Date(slot.start))}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : (upcoming.length ? <p className="role-note">Another time opens after this call.</p> : null)}
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
  const sub = 'Pay, change the card, or open an invoice.';

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
  const note = active
    ? 'The monthly charge keeps the agents running. It includes weekday replies, the monthly call, and the written report.'
    : (problem
      ? 'Update the card to keep the agents running.'
      : '$5,000 sets the agents up. $1,000 is the first month. Every month after that is $1,000.');
  return (
    <PageHead title="Subscription" sub={sub}>
      {queryStatus === 'success' ? <p className="notice">Payment received. The account updates when Stripe confirms it.</p> : null}
      {queryStatus === 'cancel' ? <p className="notice">The payment was not completed.</p> : null}
      <dl className="plan">
        <div><dt>Status</dt><dd>{label(status)}</dd></div>
        <div><dt>Price</dt><dd>{planPrice(status)}</dd></div>
      </dl>
      <p className="bill-note">{note}</p>
      <div className="portal-actions">
        {active ? (
          <button className="btn" type="button" disabled={busy === 'portal'} onClick={() => go('billing/portal', 'portal')}>Manage subscription</button>
        ) : (problem ? (
          <button className="btn" type="button" disabled={busy === 'portal'} onClick={() => go('billing/portal', 'portal')}>Update payment</button>
        ) : (
          <>
            <button className="btn" type="button" disabled={busy === 'pay'} onClick={() => go('billing/checkout', 'pay')}>Pay $6,000</button>
            <button className="btn-quiet" type="button" disabled={busy === 'portal'} onClick={() => go('billing/portal', 'portal')}>Invoices and card</button>
          </>
        ))}
      </div>
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
              {owner && member.role !== 'owner' ? (
                <div className="portal-actions"><button type="button" className="btn-quiet" onClick={() => remove(member.email)}>Remove</button></div>
              ) : null}
            </LedgerRow>
          ))}
        </Ledger>
      ) : <Empty>No one is on this account yet.</Empty>}
      {meMember ? (
        <label className="portal-check">
          <input type="checkbox" defaultChecked={meMember.digest !== false} onChange={digest} /> Email me the weekly note and the monthly report
        </label>
      ) : null}
      {owner ? (
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
  const sub = 'The rest of the account.';
  const items = [
    ['/portal/activity/', 'Activity', 'The full list of reports, with filters.'],
    ['/portal/approvals/', 'Approvals', 'Drafts waiting for you to approve or decline.'],
    ['/portal/requests/', 'Requests', 'Ask for a change. The studio answers on weekdays.'],
    ['/portal/reports/', 'Monthly report', 'The written summary of the month.'],
    ['/portal/account/', 'People', 'Who can open this account, and who gets the weekly note.'],
  ];
  if (!me) return <PageHead title="Settings" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!me.account) return <PageHead title="Settings" sub={sub}><NoAccount me={me} /></PageHead>;
  return (
    <PageHead title="Settings" sub={sub}>
      <ConnectionPanel lead="Claude, Cursor, Grok, Muse, or OpenClaw. Allow it for this office. It can see this office and do what you can do here. It cannot pay, and it cannot open another office." />
      <nav className="settings-list" aria-label="Settings">
        {items.map((item) => (
          <Link key={item[0]} href={item[0]}><span>{item[1]}</span><small>{item[2]}</small></Link>
        ))}
      </nav>
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
