'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePortal } from './session';
import { ConnectionPanel, Empty, Ledger, LedgerRow, PageHead } from './ui';
import { storeMfa } from './client';
import { label, statusClass, whenLabel } from './format';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function useConfirmReset() {
  const { api, refresh, viewer } = usePortal();
  return async function reset(email) {
    if (!email) return;
    if (!window.confirm('Reset the authenticator for ' + email + '? They set up a new one the next time they sign in. Assistant connections for that address stop until they allow them again.')) return;
    await api('admin/mfa/reset', { method: 'POST', body: { email } });
    if (viewer && viewer.user && viewer.user.email === email) {
      storeMfa('');
      window.location.href = '/portal/';
      return;
    }
    refresh();
  };
}

export function AdminHome() {
  const { me, api, openSample } = usePortal();
  const router = useRouter();
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState('');
  const sub = 'Create an account after a call.';

  useEffect(() => {
    if (!me) return undefined;
    let cancel = false;
    api('admin/accounts').then((data) => {
      if (!cancel) setAccounts(data.accounts || []);
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api]);

  async function create(event) {
    event.preventDefault();
    setError('');
    const fd = new FormData(event.target);
    try {
      const created = await api('admin/accounts', {
        method: 'POST',
        body: { office: fd.get('office'), kind: fd.get('kind'), name: fd.get('name'), email: fd.get('email') },
      });
      router.push('/portal/admin/account/?id=' + encodeURIComponent(created.account.id));
    } catch (err) {
      setError(err.message);
    }
  }

  if (!me || accounts == null && !error) return <PageHead title="Accounts" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  return (
    <PageHead title="Accounts" sub={sub}>
      <p className="notice">Harbor &amp; Finch is a sample office, with agents, approvals, meetings, and a report. <button type="button" id="open-sample" onClick={openSample}>Open it as the client</button></p>
      <p className="role-note">Open the sample office, then use Leads for people who booked or wrote.</p>
      <h2>New account</h2>
      <form className="desk-fields" onSubmit={create}>
        <label className="desk-field"><span>Business</span><input name="office" required /></label>
        <label className="desk-field"><span>Kind</span>
          <select name="kind" required defaultValue="">
            <option value="">Choose one</option>
            <option>law firm</option>
            <option>dental practice or med spa</option>
            <option>real estate office</option>
            <option>CPA firm</option>
            <option>owner-run office</option>
          </select>
        </label>
        <label className="desk-field"><span>Owner name</span><input name="name" required /></label>
        <label className="desk-field"><span>Owner email</span><input type="email" name="email" required /></label>
        <div className="desk-field-wide portal-actions"><button className="btn" type="submit">Create and invite</button></div>
        {error ? <p className="desk-status desk-field-wide">{error}</p> : null}
      </form>
      <section className="portal-section">
        <h2>Accounts</h2>
        {accounts && accounts.length ? (
          <Ledger>
            {accounts.map((account) => (
              <LedgerRow key={account.id} when={<Link href={'/portal/admin/account/?id=' + encodeURIComponent(account.id)}>{account.office}</Link>} state={statusClass(account.billingStatus)} stateName={label(account.billingStatus || 'none')}>
                {account.kind}. {label(account.status)}.
              </LedgerRow>
            ))}
          </Ledger>
        ) : <Empty>No accounts yet. The first one is created with the form above, after a call.</Empty>}
      </section>
    </PageHead>
  );
}

export function AdminLeads() {
  const { me, api } = usePortal();
  const [leads, setLeads] = useState(null);
  const [error, setError] = useState('');
  const sub = 'People who booked a call or wrote from the Studio form.';
  useEffect(() => {
    if (!me) return undefined;
    let cancel = false;
    api('admin/accounts').then((data) => {
      if (!cancel) setLeads(data.leads || []);
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api]);
  if (!me || leads == null && !error) return <PageHead title="Leads" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  return (
    <PageHead title="Leads" sub={sub}>
      {error ? <p className="desk-status">{error}</p> : null}
      {leads && leads.length ? (
        <Ledger heads={['When', 'Source', 'Lead']}>
          {leads.map((lead) => {
            const source = lead.source === 'book' ? 'Calendar' : (lead.source ? 'Form' : 'Lead');
            const detail = [lead.business, lead.chore || lead.intent].filter(Boolean).join('. ');
            const labelName = lead.name || lead.email || 'Lead';
            const bits = [];
            if (lead.email && lead.email !== labelName) bits.push(lead.email);
            if (detail) bits.push(detail);
            return (
              <LedgerRow key={(lead.email || labelName) + (lead.start || lead.createdAt)} when={whenLabel(lead.start || lead.createdAt)} state="" stateName={source}>
                <b>{labelName}</b>
                {bits.length ? <p className="ledger-detail">{bits.join('. ')}.</p> : null}
              </LedgerRow>
            );
          })}
        </Ledger>
      ) : <Empty>No leads yet. Inquiries from the Studio form and bookings from the calendar appear here.</Empty>}
    </PageHead>
  );
}

export function AdminEngineers() {
  const { me, api, refresh } = usePortal();
  const reset = useConfirmReset();
  const [desk, setDesk] = useState(null);
  const [applications, setApplications] = useState([]);
  const [applicationNote, setApplicationNote] = useState('');
  const [error, setError] = useState('');
  const sub = 'Invite someone after their photo and profile are merged.';
  const owner = !!(me && me.user && me.user.owner);

  useEffect(() => {
    if (!me) return undefined;
    let cancel = false;
    api('admin/accounts').then(async (data) => {
      if (cancel) return;
      setDesk(data);
      if (!(me.user && me.user.owner)) return;
      try {
        const listed = await api('admin/engineers/applications');
        if (!cancel) setApplications(listed.applications || []);
      } catch (err) {
        if (!cancel) setApplicationNote(err.message);
      }
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api]);

  async function inviteGithub(row) {
    setError('');
    try {
      await api('admin/engineers', {
        method: 'POST',
        body: { name: row.name, github: row.login, pr: Number(row.pr), email: row.email || '' },
      });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function invite(event) {
    event.preventDefault();
    setError('');
    const fd = new FormData(event.target);
    try {
      await api('admin/engineers', { method: 'POST', body: { name: fd.get('name'), email: fd.get('email') } });
      event.target.reset();
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!me || desk == null && !error) return <PageHead title="Engineers" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  const engineers = (desk && desk.engineers) || [];
  return (
    <PageHead title="Engineers" sub={sub}>
      {owner ? (
        <>
          <h2>Engineer applications</h2>
          <p className="role-note">The pull request stays tied to the GitHub account that opened it. Merge it, then invite that account.</p>
          {applicationNote ? <p className="desk-status">{applicationNote}</p> : null}
          {applications.length ? (
            <Ledger heads={['Person', 'Status', 'Pull request']}>
              {applications.map((row) => (
                <LedgerRow key={row.pr} when={row.name + ' · ' + row.login} state="" stateName={row.merged ? 'Merged' : 'Open'}>
                  {row.email ? row.email : 'No sign-in email on the pull request. They sign in with GitHub.'}
                  <p className="ledger-detail">
                    PR {row.pr}.{' '}
                    {row.merged
                      ? <button type="button" className="btn-quiet" onClick={() => inviteGithub(row)}>Invite</button>
                      : 'Merge the pull request before the invite.'}
                  </p>
                </LedgerRow>
              ))}
            </Ledger>
          ) : <Empty>No engineer pull requests yet.</Empty>}
          <h2>Invite an engineer</h2>
          <p className="role-note">Their photo and profile have to be merged under Your Engineers first. This invite is what lets them sign in.</p>
          <form className="desk-fields" onSubmit={invite}>
            <label className="desk-field"><span>Name</span><input name="name" required /></label>
            <label className="desk-field"><span>Email</span><input type="email" name="email" required /></label>
            <div className="desk-field-wide portal-actions"><button className="btn" type="submit">Send invite</button></div>
            {error ? <p className="desk-status desk-field-wide">{error}</p> : null}
          </form>
        </>
      ) : (
        <>
          <h2>Engineers</h2>
          <p className="role-note">The Studio owner sends an engineer invite after the photo and profile are merged.</p>
        </>
      )}
      {engineers.length ? (
        <Ledger heads={['Name', 'Status', 'Email']}>
          {engineers.map((row) => {
            const state = row.status !== 'claimed' ? 'Invited' : (row.profile === 'opened' ? 'Pull request opened' : 'Joined');
            return (
              <LedgerRow key={row.email || row.github || row.name} when={row.name || row.email} state="" stateName={state}>
                {row.email || 'GitHub sign-in'}{row.github ? ' · ' + row.github : ''}
                {row.email ? <> <button type="button" className="btn-quiet" onClick={() => reset(row.email).catch((err) => setError(err.message))}>Reset authenticator</button></> : null}
              </LedgerRow>
            );
          })}
        </Ledger>
      ) : <Empty>No engineers invited yet.</Empty>}
      {error && !owner ? <p className="desk-status">{error}</p> : null}
      <ConnectionPanel lead="Connect Claude, Cursor, Grok, Muse, or OpenClaw to this engineer account. When it asks you to sign in, allow it as an engineer. It can open the offices, set up agents, and post reports. It cannot pay, and it cannot invite another engineer." />
    </PageHead>
  );
}

export function AdminAccount() {
  const { me, api, refresh, openClientPreview } = usePortal();
  const id = useSearchParams().get('id') || '';
  const reset = useConfirmReset();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [keyText, setKeyText] = useState('');

  useEffect(() => {
    if (!me || !id) return undefined;
    let cancel = false;
    api('admin/accounts/' + encodeURIComponent(id)).then((next) => {
      if (!cancel) setData(next);
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api, id]);

  if (!id) return <PageHead title="Account" sub=""><p className="desk-status">Missing account.</p></PageHead>;
  if (!me || (!data && !error)) return <PageHead title="Account" sub=""><p className="portal-loading">Loading.</p></PageHead>;
  if (error && !data) return <PageHead title="Account" sub=""><p className="desk-status">{error}</p></PageHead>;

  const acc = data.account;
  const sub = acc.kind + '. ' + label(acc.status) + '. Billing ' + label(acc.billingStatus || 'none').toLowerCase() + '.';
  const pending = (data.approvals || []).filter((item) => item.status === 'pending');
  const people = (acc.members || []).filter((member) => member && member.email);

  async function saveReply(event) {
    event.preventDefault();
    setError('');
    setSaved(false);
    try {
      await api('admin/reply', { method: 'POST', body: { accountId: id, replyTime: new FormData(event.target).get('replyTime') } });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }
  async function createAgent(event) {
    event.preventDefault();
    setError('');
    const fd = new FormData(event.target);
    try {
      const created = await api('admin/agents', { method: 'POST', body: { accountId: id, name: fd.get('name'), chore: fd.get('chore'), steps: fd.get('steps') } });
      setKeyText('Copy this key now. It is not shown again. ' + created.agent.apiKey);
    } catch (err) {
      setError(err.message);
    }
  }
  async function showKey(agentId) {
    setError('');
    try {
      const shown = await api('admin/agents/key', { method: 'POST', body: { accountId: id, agentId } });
      setKeyText('Copy this key now. It is not shown again. ' + shown.apiKey);
    } catch (err) {
      setError(err.message);
    }
  }
  async function saveFlow(event, agentId) {
    event.preventDefault();
    setError('');
    try {
      await api('admin/agents/flow', { method: 'POST', body: { accountId: id, agentId, steps: new FormData(event.target).get('steps') } });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }
  async function setStatus(agentId, status) {
    setError('');
    try {
      await api('admin/agents/status', { method: 'POST', body: { accountId: id, agentId, status } });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }
  async function note(event) {
    event.preventDefault();
    setError('');
    try {
      await api('admin/notes', { method: 'POST', body: { accountId: id, summary: new FormData(event.target).get('summary') } });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }
  async function approve(approvalId) {
    setError('');
    try {
      await api('admin/approvals', { method: 'POST', body: { accountId: id, id: approvalId, decision: 'approved' } });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }
  async function done(requestId) {
    setError('');
    try {
      await api('admin/requests', { method: 'POST', body: { accountId: id, id: requestId } });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }
  async function report() {
    setError('');
    try {
      await api('admin/reports', { method: 'POST', body: { accountId: id } });
      openClientPreview(id, '/portal/reports/');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <PageHead title={acc.office} sub={sub}>
      <form className="desk-fields" onSubmit={saveReply}>
        <label className="desk-field desk-field-wide">
          <span>Reply time shown on the account</span>
          <input name="replyTime" defaultValue={acc.replyTime || ''} placeholder="Weekdays, within one business day" />
        </label>
        <div className="desk-field-wide portal-actions">
          <button className="btn" type="submit">Save</button>
          {saved ? <p className="saved">Saved.</p> : null}
        </div>
      </form>
      {people.length ? (
        <section className="portal-section">
          <h2>Authenticator</h2>
          <p className="role-note">If someone loses the authenticator and the backup codes, clear it. They set up a new one the next time they sign in.</p>
          {people.map((member) => (
            <div className="portal-actions" key={member.email}>
              <button type="button" className="btn-quiet" onClick={() => reset(member.email).catch((err) => setError(err.message))}>Reset authenticator for {member.email}</button>
            </div>
          ))}
        </section>
      ) : null}
      <section className="portal-section">
        <h2>Agents</h2>
        {(data.agents || []).length ? (
          <Ledger>
            {data.agents.map((agent) => {
              const next = agent.status === 'running' ? 'paused' : 'running';
              const verb = agent.status === 'running' ? 'Pause' : 'Mark running';
              return (
                <LedgerRow key={agent.id} when={agent.name} state={statusClass(agent.status)} stateName={label(agent.status)}>
                  {agent.chore}
                  <div className="portal-actions">
                    <button type="button" className="btn-quiet" onClick={() => setStatus(agent.id, next)}>{verb}</button>
                    {agent.keyWaiting ? <button type="button" className="btn-quiet" onClick={() => showKey(agent.id)}>Show the key once</button> : null}
                  </div>
                  <form className="agent-flow" onSubmit={(event) => saveFlow(event, agent.id)}>
                    <label><span>Flow, one step per line</span><textarea name="steps" rows={4} maxLength={2200} defaultValue={(agent.steps || []).join('\n')} /></label>
                    <button className="btn-quiet" type="submit">Save flow</button>
                  </form>
                </LedgerRow>
              );
            })}
          </Ledger>
        ) : <Empty>No agents yet.</Empty>}
        <form className="desk-fields" onSubmit={createAgent}>
          <label className="desk-field"><span>Name</span><input name="name" required /></label>
          <label className="desk-field"><span>Chore</span><input name="chore" required /></label>
          <label className="desk-field desk-field-wide"><span>Flow, one step per line</span><textarea name="steps" rows={4} placeholder="Optional. A new inquiry arrives." /></label>
          <div className="desk-field-wide portal-actions"><button className="btn" type="submit">Create agent</button></div>
        </form>
        {keyText ? <p className="key-once">{keyText}</p> : null}
      </section>
      <section className="portal-section">
        <h2>Note</h2>
        <form className="desk-fields" onSubmit={note}>
          <label className="desk-field desk-field-wide"><span>What happened</span><input name="summary" required /></label>
          <div className="desk-field-wide portal-actions"><button className="btn" type="submit">Post to the activity log</button></div>
        </form>
      </section>
      <section className="portal-section">
        <h2>Approvals</h2>
        {pending.length ? (
          <Ledger>
            {pending.map((item) => (
              <LedgerRow key={item.id} when={whenLabel(item.createdAt)} state="waiting" stateName="Waiting">
                {item.summary}
                <div className="portal-actions"><button className="btn" type="button" onClick={() => approve(item.id)}>Approve</button></div>
              </LedgerRow>
            ))}
          </Ledger>
        ) : <Empty>Nothing is waiting.</Empty>}
      </section>
      <section className="portal-section">
        <h2>Requests</h2>
        {(data.requests || []).length ? (
          <Ledger>
            {data.requests.map((item) => (
              <LedgerRow key={item.id} when={whenLabel(item.createdAt)} state={statusClass(item.status)} stateName={label(item.status)}>
                {item.summary}
                {item.status === 'open' ? <div className="portal-actions"><button className="btn-quiet" type="button" onClick={() => done(item.id)}>Mark done</button></div> : null}
              </LedgerRow>
            ))}
          </Ledger>
        ) : <Empty>No requests.</Empty>}
      </section>
      <div className="portal-actions"><button className="btn-quiet" type="button" onClick={report}>Write this month’s report</button></div>
      {error ? <p className="desk-status">{error}</p> : null}
    </PageHead>
  );
}

export function AdminAvailability() {
  const { me, api } = usePortal();
  const [availability, setAvailability] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const sub = 'Leave a day blank to keep it closed. Hours look like 10:00.';

  useEffect(() => {
    if (!me) return undefined;
    let cancel = false;
    api('admin/availability').then((data) => {
      if (!cancel) setAvailability(data.availability);
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [me, api]);

  async function save(event) {
    event.preventDefault();
    setError('');
    setSaved(false);
    const fd = new FormData(event.target);
    const windows = [];
    for (let i = 0; i < 7; i++) {
      const start = String(fd.get('start-' + i) || '').trim();
      const end = String(fd.get('end-' + i) || '').trim();
      if (start && end) windows.push({ dow: i, start, end });
    }
    const exceptions = String(fd.get('closed') || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).map((date) => ({ date, closed: true }));
    try {
      await api('admin/availability', {
        method: 'PUT',
        body: {
          timeZone: fd.get('timeZone'),
          bufferMin: Number(fd.get('bufferMin')),
          durations: {
            discovery: Number(fd.get('discovery')),
            checkpoint: Number(fd.get('checkpoint')),
            monthly: Number(fd.get('monthly')),
          },
          windows,
          exceptions,
        },
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!me || (!availability && !error)) return <PageHead title="Availability" sub={sub}><p className="portal-loading">Loading.</p></PageHead>;
  if (!availability) return <PageHead title="Availability" sub={sub}><p className="desk-status">{error}</p></PageHead>;
  const byDay = {};
  (availability.windows || []).forEach((window) => { byDay[window.dow] = window; });
  const closed = (availability.exceptions || []).filter((item) => item.closed).map((item) => item.date).join('\n');
  return (
    <PageHead title="Availability" sub={sub}>
      <form className="desk-fields" onSubmit={save}>
        <label className="desk-field"><span>Time zone</span><input name="timeZone" defaultValue={availability.timeZone} required /></label>
        <label className="desk-field"><span>Buffer, minutes</span><input name="bufferMin" type="number" min="0" max="120" defaultValue={availability.bufferMin} /></label>
        <label className="desk-field"><span>Discovery, minutes</span><input name="discovery" type="number" min="10" max="180" defaultValue={availability.durations.discovery} /></label>
        <label className="desk-field"><span>Checkpoint, minutes</span><input name="checkpoint" type="number" min="10" max="180" defaultValue={availability.durations.checkpoint} /></label>
        <label className="desk-field"><span>Monthly, minutes</span><input name="monthly" type="number" min="10" max="180" defaultValue={availability.durations.monthly} /></label>
        {DAYS.map((name, i) => {
          const window = byDay[i] || { start: '', end: '' };
          return (
            <div className="desk-field desk-field-wide" key={name}>
              <span>{name}{window.start ? '' : ' (closed)'}</span>
              <span className="day-times">
                <label className="day-time"><span>Start</span><input type="time" name={'start-' + i} defaultValue={window.start} aria-label={name + ' start'} /></label>
                <label className="day-time"><span>End</span><input type="time" name={'end-' + i} defaultValue={window.end} aria-label={name + ' end'} /></label>
              </span>
            </div>
          );
        })}
        <label className="desk-field desk-field-wide">
          <span>Closed dates, one YYYY-MM-DD per line</span>
          <textarea name="closed" rows={4} defaultValue={closed} />
        </label>
        <div className="desk-field-wide portal-actions">
          <button className="btn" type="submit">Save</button>
          {saved ? <p className="saved">Saved.</p> : null}
        </div>
        {error ? <p className="desk-status desk-field-wide">{error}</p> : null}
      </form>
    </PageHead>
  );
}
