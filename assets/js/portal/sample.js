// Harbor & Finch is a sample office. It lives in the browser so the engineer
// can walk the client portal without touching a real account.

export const SAMPLE_ID = 'sample';

function atHour(daysAhead, hour) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function monthKey(offset) {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return date.getUTCFullYear() + '-' + month;
}

function when(iso) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

function dayLabel(daysAhead) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(atHour(daysAhead, 12)));
}

function fresh() {
  const upcoming = atHour(4, 10);
  const past = atHour(-18, 15);
  const reminderDay = dayLabel(-3);
  return {
    office: 'Harbor & Finch',
    kind: 'law firm',
    status: 'active',
    billingStatus: 'none',
    replyTime: 'Weekdays, within one business day',
    members: [
      { email: 'ada@harborfinch.example', name: 'Ada Finch', role: 'owner', digest: true },
      { email: 'jules@harborfinch.example', name: 'Jules Park', role: 'member', digest: false },
    ],
    agents: [
      { id: 'intake', name: 'Intake', status: 'running', chore: 'Reads a new inquiry and drafts the first reply for Ada to send.' },
      { id: 'chase', name: 'Chase', status: 'running', chore: 'Follows up on documents the firm is still waiting on.' },
      {
        id: 'review',
        name: 'Review',
        status: 'paused',
        chore: 'Checks a client email before it goes out, when that kind of email has not been sent before.',
        pauseNote: 'Paused until Ada signs off a new kind of client email. It does not send mail while it is paused.',
      },
    ],
    activity: [
      { id: 'a2', ts: atHour(-1, 16), type: 'did', agentId: 'intake', summary: 'Intake answered a new inquiry from a buyer’s broker.', detail: 'It asked for the closing date and the lender.' },
      { id: 'a1', ts: atHour(-1, 9), type: 'needs_approval', agentId: 'review', summary: 'Review drafted a fee-update email to existing clients.', detail: 'The draft is on Approvals. The firm has not sent a fee change before.' },
      { id: 'a3', ts: atHour(-2, 11), type: 'blocked', agentId: 'chase', summary: 'Chase is waiting on the signed engagement letter for Morales.', detail: 'The third reminder went out on ' + reminderDay + '.' },
      { id: 'a7', ts: atHour(-3, 13), type: 'needs_approval', agentId: 'review', summary: 'Review drafted the first reply to a referral from North & Co.', detail: 'The draft is on Approvals. The greeting has not been used before.' },
      { id: 'a4', ts: atHour(-4, 14), type: 'did', agentId: 'chase', summary: 'Chase collected the missing tax return from Hale.' },
      { id: 'a5', ts: atHour(-6, 10), type: 'note', agentId: '', summary: 'The weekly note was posted.', detail: 'Two matters are waiting on documents. Morales is the one that is blocked.' },
      { id: 'a6', ts: atHour(-9, 15), type: 'did', agentId: 'intake', summary: 'Intake declined a matter outside the firm’s work.', detail: 'It sent the usual referral note.' },
    ],
    approvals: [
      {
        id: 'p1',
        createdAt: atHour(-1, 9),
        status: 'pending',
        subject: 'Fee update to existing clients',
        summary: 'Fee update to existing clients',
        why: 'Harbor & Finch has not sent a fee change before. Review will not send this kind of email until Ada approves the wording.',
        draft: 'Dear client,\n\nStarting next month, our flat fee for a standard closing is $1,850. Work already under way keeps the fee we agreed.\n\nAda Finch\nHarbor & Finch',
      },
      {
        id: 'p2',
        createdAt: atHour(-3, 13),
        status: 'pending',
        subject: 'First reply to a referral from North & Co.',
        summary: 'First reply to a referral from North & Co.',
        why: 'This is the first time the firm has answered a referral from another firm. The greeting is new, so a person has to approve it before it goes out.',
        draft: 'Dear North & Co.,\n\nThank you for sending the Morales closing. We can take it. Our engagement letter is attached, and we will follow up on the missing signature ourselves.\n\nAda Finch\nHarbor & Finch',
      },
    ],
    requests: [
      { id: 'r1', createdAt: atHour(-5, 12), status: 'open', summary: 'Leave Chase running. Keep Review paused until the fee email is approved.' },
      { id: 'r2', createdAt: atHour(-21, 9), status: 'done', summary: 'Use the firm’s full name, Harbor & Finch, in the first sentence of every reply.' },
    ],
    meetings: [
      { id: 'm1', type: 'checkpoint', status: 'booked', start: upcoming, end: atHour(4, 11), when: when(upcoming) },
      { id: 'm2', type: 'monthly', status: 'held', start: past, end: past, when: when(past) },
    ],
    reports: [
      {
        month: monthKey(0),
        soFar: true,
        total: 7,
        counts: { did: 3, waiting: 2, blocked: 1, note: 1 },
        highlights: [
          'Intake answered one new inquiry and declined one matter outside the firm’s work.',
          'Chase collected Hale’s tax return and is still waiting on the Morales engagement letter.',
          'Two drafts are waiting on Ada: a fee update, and the first reply to North & Co.',
        ],
      },
      {
        month: monthKey(-1),
        total: 22,
        counts: { did: 16, waiting: 2, blocked: 3, note: 1 },
        highlights: [
          'Intake answered 14 new inquiries.',
          'Chase cleared the documents that were already in hand at the start of the month.',
          'Review stayed paused. No new kind of client email was sent.',
        ],
      },
      {
        month: monthKey(-2),
        total: 17,
        counts: { did: 14, waiting: 0, blocked: 2, note: 1 },
        highlights: [
          'The firm started with Intake and Chase.',
          'Review was set up and left paused until a new kind of email needed a signature.',
        ],
      },
    ],
    invoices: [],
    holds: {},
  };
}

let state = fresh();
let viewerEmail = '';
let viewerName = '';

export function bindSampleUser(email, name) {
  viewerEmail = String(email || '').toLowerCase();
  viewerName = name || '';
}

export function resetSample() {
  state = fresh();
}

export function sampleAccount() {
  return {
    id: SAMPLE_ID,
    office: state.office,
    kind: state.kind,
    status: state.status,
    billingStatus: state.billingStatus,
    replyTime: state.replyTime,
    role: 'owner',
    members: state.members.map(function (member) {
      return { email: member.email, name: member.name, role: member.role, digest: member.digest !== false };
    }),
    invoices: state.invoices || [],
    sample: true,
  };
}

function sortedActivity() {
  return state.activity.slice().sort(function (a, b) {
    return String(b.ts).localeCompare(String(a.ts));
  });
}

function splitPath(path) {
  const clean = String(path || '').replace(/^\//, '');
  const mark = clean.indexOf('?');
  return {
    route: mark === -1 ? clean : clean.slice(0, mark),
    query: new URLSearchParams(mark === -1 ? '' : clean.slice(mark + 1)),
  };
}

function upcomingMeeting() {
  const now = Date.now();
  return state.meetings.find(function (meeting) {
    return meeting.status === 'booked' && new Date(meeting.start).getTime() > now;
  }) || null;
}

function hourTaken(iso) {
  const key = iso.slice(0, 13);
  return state.meetings.some(function (meeting) {
    return meeting.status === 'booked' && String(meeting.start).slice(0, 13) === key;
  });
}

function slots(type) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  const upcomingCheckpoint = state.meetings.some(function (meeting) {
    return meeting.type === 'checkpoint' && meeting.status === 'booked' && new Date(meeting.start).getTime() > Date.now();
  });
  if (type === 'checkpoint' && upcomingCheckpoint) {
    return { slots: [], timeZone: timeZone, type: type, closed: 'A checkpoint is already booked. Another one is not offered until that call has happened.' };
  }
  const hours = [10, 11, 14, 15];
  const list = [];
  for (let day = 1; list.length < 8 && day < 40; day += 1) {
    const date = new Date();
    date.setDate(date.getDate() + day);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    date.setHours(hours[list.length % hours.length], 0, 0, 0);
    const start = date.toISOString();
    if (hourTaken(start)) continue;
    list.push({ start: start, end: new Date(date.getTime() + 45 * 60 * 1000).toISOString() });
  }
  return { slots: list, timeZone: timeZone, type: type };
}

export function sampleApi(path, opts) {
  const options = opts || {};
  const method = options.method || 'GET';
  const body = options.body || {};
  const parsed = splitPath(path);
  const route = parsed.route;

  if (method === 'GET' && route === 'me') {
    return Promise.resolve({ user: null, account: sampleAccount() });
  }
  if (method === 'GET' && route === 'home') {
    return Promise.resolve({
      account: sampleAccount(),
      agents: state.agents,
      activity: sortedActivity().slice(0, 8),
      approvals: state.approvals.filter(function (item) { return item.status === 'pending'; }),
      requests: state.requests.filter(function (item) { return item.status === 'open'; }),
      upcoming: upcomingMeeting(),
    });
  }
  if (method === 'GET' && route === 'agents') {
    return Promise.resolve({ agents: state.agents });
  }
  if (method === 'GET' && route === 'activity') {
    const type = parsed.query.get('type') || '';
    const agent = parsed.query.get('agent') || '';
    const activity = sortedActivity().filter(function (row) {
      if (type && row.type !== type) return false;
      if (agent && row.agentId !== agent) return false;
      return true;
    });
    return Promise.resolve({ activity: activity, agents: state.agents });
  }
  if (method === 'GET' && route === 'approvals') {
    return Promise.resolve({
      approvals: state.approvals.filter(function (item) { return item.status === 'pending'; }),
    });
  }
  if (method === 'POST' && route === 'approvals') {
    const item = state.approvals.find(function (row) { return row.id === body.id; });
    if (!item) return Promise.reject(new Error('That approval is not here.'));
    item.status = body.decision === 'declined' ? 'declined' : 'approved';
    state.activity.unshift({
      id: 'a-' + Date.now(),
      ts: new Date().toISOString(),
      type: item.status === 'approved' ? 'did' : 'note',
      agentId: 'review',
      summary: item.summary,
      approvedBy: item.status === 'approved' ? 'Ada Finch' : '',
    });
    return Promise.resolve({ approval: item });
  }
  if (method === 'GET' && route === 'requests') {
    return Promise.resolve({ requests: state.requests });
  }
  if (method === 'POST' && route === 'requests') {
    const summary = String(body.summary || '').trim();
    if (summary.length < 2) return Promise.reject(new Error('Write the change.'));
    const request = { id: 'r-' + Date.now(), createdAt: new Date().toISOString(), status: 'open', summary: summary };
    state.requests.unshift(request);
    return Promise.resolve({ request: request });
  }
  if (method === 'GET' && route === 'meetings') {
    return Promise.resolve({ meetings: state.meetings });
  }
  if (method === 'GET' && route === 'meetings/slots') {
    return Promise.resolve(slots(parsed.query.get('type') === 'monthly' ? 'monthly' : 'checkpoint'));
  }
  if (method === 'POST' && route === 'meetings/hold') {
    const token = 'hold-' + Date.now();
    state.holds[token] = body.start;
    return Promise.resolve({ holdToken: token, start: body.start });
  }
  if (method === 'POST' && route === 'meetings') {
    const start = body.start;
    if (!start) return Promise.reject(new Error('Choose a time.'));
    const meeting = {
      id: 'm-' + Date.now(),
      type: body.type === 'monthly' ? 'monthly' : 'checkpoint',
      status: 'booked',
      start: start,
      end: start,
      when: when(start),
    };
    state.meetings.unshift(meeting);
    return Promise.resolve({ meeting: meeting });
  }
  if (method === 'POST' && route === 'meetings/cancel') {
    const meeting = state.meetings.find(function (row) { return row.id === body.id; });
    if (!meeting) return Promise.reject(new Error('That call is not on this account.'));
    meeting.status = 'cancelled';
    return Promise.resolve({ meeting: meeting });
  }
  if (method === 'GET' && route === 'reports') {
    return Promise.resolve({ reports: state.reports });
  }
  if (method === 'POST' && route === 'billing/checkout') {
    state.billingStatus = 'active';
    state.invoices.unshift({
      id: 'inv-' + Date.now(),
      when: new Date().toISOString(),
      label: 'Setup and first month',
      amount: '$6,000',
      status: 'Paid',
    });
    return Promise.resolve({ sample: true });
  }
  if (method === 'POST' && route === 'billing/portal') {
    return Promise.resolve({ sample: true, notice: 'A real client would open invoices and the card on Stripe.' });
  }
  if (method === 'GET' && route === 'account') {
    return Promise.resolve({ account: sampleAccount() });
  }
  if (method === 'POST' && route === 'members/digest') {
    const member = state.members.find(function (row) { return row.email === viewerEmail; });
    if (member) member.digest = Boolean(body.digest);
    return Promise.resolve({ ok: true });
  }
  if (method === 'POST' && route === 'members/remove') {
    state.members = state.members.filter(function (row) { return row.email !== body.email; });
    return Promise.resolve({ ok: true });
  }
  if (method === 'POST' && route === 'members') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) return Promise.reject(new Error('A valid email is required.'));
    state.members.push({ email: email, name: String(body.name || '').trim(), role: 'member', digest: true });
    return Promise.resolve({ ok: true });
  }
  return Promise.reject(new Error('Not found.'));
}
