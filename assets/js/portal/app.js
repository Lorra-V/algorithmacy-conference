import { api, authApi, esc, getAuth, getConfig, safeNext, waitForUser } from './api.js';

const GROUPS = [
  [['dashboard', '/portal/', 'Today']],
  [
    ['activity', '/portal/activity/', 'Activity'],
    ['agents', '/portal/agents/', 'Agents'],
    ['approvals', '/portal/approvals/', 'Approvals'],
    ['requests', '/portal/requests/', 'Requests'],
  ],
  [
    ['meetings', '/portal/meetings/', 'Meetings'],
    ['reports', '/portal/reports/', 'Reports'],
  ],
  [
    ['billing', '/portal/billing/', 'Billing'],
    ['account', '/portal/account/', 'Account'],
  ],
];

const LABELS = {
  did: 'Done',
  needs_approval: 'Waiting on you',
  blocked: 'Blocked',
  error: 'Error',
  note: 'Note',
  pending: 'Waiting',
  approved: 'Approved',
  declined: 'Declined',
  open: 'Open',
  done: 'Done',
  learning: 'Learning',
  running: 'Running',
  paused: 'Paused',
  booked: 'Booked',
  cancelled: 'Cancelled',
  canceled: 'Canceled',
  held: 'Held',
  invited: 'Invited',
  claimed: 'Claimed',
  active: 'Active',
  none: 'Not started',
  trialing: 'Trial',
  past_due: 'Past due',
  unpaid: 'Unpaid',
  incomplete: 'Incomplete',
  incomplete_expired: 'Incomplete',
  discovery: 'Discovery',
  checkpoint: 'Checkpoint',
  monthly: 'Monthly',
  owner: 'Owner',
  member: 'Member',
};

const root = document.getElementById('portal');
const page = root ? root.dataset.page : '';
let viewer = null;

function label(value) {
  if (value == null || value === '') return '';
  const key = String(value);
  if (LABELS[key]) return LABELS[key];
  return key.replace(/_/g, ' ');
}

function statusClass(value) {
  if (value === 'needs_approval' || value === 'pending' || value === 'open') return 'waiting';
  if (value === 'blocked' || value === 'error' || value === 'past_due' || value === 'declined' || value === 'unpaid') return 'blocked';
  return '';
}

function whenLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function monthLabel(key) {
  const match = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!match) return key || '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(+match[1], +match[2] - 1, 1)));
}

function accountLine(account) {
  const bits = [label(account.status), 'Billing ' + label(account.billingStatus || 'none').toLowerCase()];
  if (account.replyTime) bits.push(account.replyTime);
  return bits.join('. ') + '.';
}

function ledger(rows, heads) {
  if (!rows) return '';
  const head = heads && heads.length
    ? '<thead><tr>' + heads.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead>'
    : '';
  return '<figure class="record ledger"><table>' + head + '<tbody>' + rows + '</tbody></table></figure>';
}

function ledgerRow(when, state, stateName, entry) {
  const head = when && typeof when === 'object' ? when.html : esc(when);
  return '<tr><th>' + head + '</th><td class="status ' + state + '">' + esc(stateName) + '</td><td>' + entry + '</td></tr>';
}

function empty(text) {
  return '<p class="portal-empty">' + esc(text) + '</p>';
}

function activityEntry(row) {
  return esc(row.summary) +
    (row.detail ? '<p class="ledger-detail">' + esc(row.detail) + '</p>' : '') +
    (row.approvedBy ? '<p class="ledger-detail">Signed off by ' + esc(row.approvedBy) + '.</p>' : '');
}

function personName(user) {
  const raw = user && typeof user.name === 'string' ? user.name.trim() : '';
  if (!raw || raw.indexOf('@') !== -1) return (user && user.email) || '';
  if (raw !== raw.toLowerCase()) return raw;
  return raw.replace(/\b[a-z]/g, function (letter) { return letter.toUpperCase(); });
}

function revealRail(nav) {
  const current = nav.querySelector('[aria-current="page"]');
  if (current) {
    const railBox = nav.getBoundingClientRect();
    const linkBox = current.getBoundingClientRect();
    nav.scrollLeft += linkBox.left - railBox.left - (nav.clientWidth - linkBox.width) / 2;
  }
  function edges() {
    nav.classList.toggle('rail-more-left', nav.scrollLeft > 4);
    nav.classList.toggle('rail-more-right', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
  }
  if (!nav.dataset.edges) {
    nav.dataset.edges = '1';
    nav.addEventListener('scroll', edges, { passive: true });
  }
  edges();
}

function rail(user) {
  const groups = GROUPS.slice();
  if (user && user.isAdmin) {
    groups.push([
      ['admin', '/portal/admin/', 'Admin'],
      ['admin-availability', '/portal/admin/availability/', 'Availability'],
    ]);
  }
  return groups.map(function (group, index) {
    const links = group.map(function (item) {
      const current = item[0] === page || (item[0] === 'admin' && page === 'admin-account');
      return '<a href="' + item[1] + '"' + (current ? ' aria-current="page"' : '') + '>' + item[2] + '</a>';
    }).join('');
    return (index ? '<span class="rail-break"></span>' : '') + links;
  }).join('');
}

async function signOut() {
  const button = document.getElementById('sign-out');
  if (button) button.disabled = true;
  try {
    const auth = await getAuth();
    if (auth) await authApi().signOut(auth);
  } catch (e) { /* leave the page either way */ }
  location.href = '/portal/login/';
}

function shell(user, title, sub) {
  const meta = document.getElementById('portal-top-meta');
  if (meta) {
    const office = viewer && viewer.account && viewer.account.office;
    const who = office || personName(user);
    meta.innerHTML = (who ? '<span class="portal-who">' + esc(who) + '</span>' : '') +
      '<button type="button" class="top-signout" id="sign-out">Sign out</button>';
    document.getElementById('sign-out').addEventListener('click', signOut);
  }
  const head =
    '<header class="page-head"><h1>' + esc(title) + '</h1>' +
    (sub ? '<p>' + esc(sub) + '</p>' : '') +
    '</header><div id="portal-main"><p class="portal-loading">Loading.</p></div>';
  const nav = document.getElementById('portal-nav');
  if (nav) {
    nav.hidden = false;
    nav.innerHTML = rail(user);
    revealRail(nav);
    root.innerHTML = head;
  } else {
    root.innerHTML =
      '<div class="portal-frame"><nav class="rail" aria-label="Portal">' + rail(user) + '</nav>' +
      '<div class="portal-body">' + head + '</div></div>';
    revealRail(root.querySelector('.rail'));
  }
  return document.getElementById('portal-main');
}

function setHead(title, sub) {
  const heading = document.querySelector('#portal .page-head h1');
  if (heading && title) heading.textContent = title;
  const head = document.querySelector('#portal .page-head');
  if (!head) return;
  let line = head.querySelector('p');
  if (!sub) {
    if (line) line.remove();
    return;
  }
  if (!line) {
    line = document.createElement('p');
    head.appendChild(line);
  }
  line.textContent = sub;
}

function loginNext() {
  return safeNext(new URLSearchParams(location.search).get('next') || '/portal/');
}

async function renderLogin() {
  const cfg = await getConfig();
  const email = new URLSearchParams(location.search).get('email') || '';
  root.innerHTML =
    '<h1>Sign in to the Studio portal.</h1>' +
    '<p class="portal-login-lead">An account is created after a call. Use the email the invite went to.</p>' +
    (cfg.configured ? '' : '<p class="desk-status">Sign-in is not open yet. Write to <a href="mailto:topanga@algorithmacy.org">topanga@algorithmacy.org</a>.</p>') +
    '<form class="desk-fields" id="login-form">' +
    '<label class="desk-field desk-field-wide"><span>Email</span><input type="email" name="email" required autocomplete="email" value="' + esc(email) + '"></label>' +
    '<p class="book-hp" hidden><input name="website" tabindex="-1" autocomplete="off" aria-hidden="true"></p>' +
    '<div class="desk-field-wide"><button class="btn" type="submit">Email me a link</button></div>' +
    '<p class="desk-status desk-field-wide" id="login-error" hidden></p>' +
    '<p class="portal-or desk-field-wide" id="login-note" role="status"></p>' +
    (cfg.configured ? '<div class="desk-field-wide"><button class="btn-quiet" type="button" id="google">Continue with Google</button></div>' : '') +
    '</form>' +
    '<p class="portal-or">No account yet? <a href="/book/">Book a 20-minute call</a>.</p>';
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const err = document.getElementById('login-error');
    err.hidden = true;
    const fd = new FormData(form);
    const address = String(fd.get('email') || '').trim();
    localStorage.setItem('studioEmail', address);
    try {
      const res = await fetch('/api/portal/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, website: fd.get('website') || '' }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || 'We could not send that.');
      document.getElementById('login-note').textContent = 'If that address has an account, a link is on its way. It works once.';
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
  const google = document.getElementById('google');
  if (google) google.addEventListener('click', async function () {
    const err = document.getElementById('login-error');
    err.hidden = true;
    try {
      const auth = await getAuth();
      const fns = authApi();
      await fns.signInWithPopup(auth, new fns.GoogleAuthProvider());
      location.href = loginNext();
    } catch (e) {
      err.hidden = false;
      const code = e && e.code;
      err.textContent = code === 'auth/popup-blocked'
        ? 'The browser blocked the Google window. Allow popups for this site, or use the email link.'
        : (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
          ? 'Google sign-in was closed before it finished.'
          : (e.message || 'Google sign-in did not finish.'));
    }
  });
}

async function renderFinish() {
  root.innerHTML = '<header class="page-head"><h1>Signing in.</h1><p id="finish-note">Checking the link.</p></header>';
  const note = document.getElementById('finish-note');
  try {
    const auth = await getAuth();
    if (!auth) throw new Error('Sign-in is not open yet.');
    const fns = authApi();
    if (!fns.isSignInWithEmailLink(auth, location.href)) {
      note.textContent = 'That link is not a sign-in link. Request another.';
      return;
    }
    let email = localStorage.getItem('studioEmail') || '';
    if (!email) email = window.prompt('Email address for this link') || '';
    if (!email) throw new Error('The email address is required to finish signing in.');
    await fns.signInWithEmailLink(auth, email, location.href);
    localStorage.removeItem('studioEmail');
    location.replace('/portal/');
  } catch (e) {
    note.textContent = e.message || 'That link did not work. Request another.';
  }
}

async function session() {
  const auth = await getAuth();
  if (!auth) {
    const meta = document.getElementById('portal-top-meta');
    if (meta) meta.textContent = '';
    root.innerHTML = '<header class="page-head"><h1>Sign-in is not open yet.</h1><p>Write to <a href="mailto:topanga@algorithmacy.org">topanga@algorithmacy.org</a>.</p></header>';
    return null;
  }
  const user = await waitForUser(auth);
  if (!user) {
    location.href = '/portal/login/?next=' + encodeURIComponent(location.pathname + location.search);
    return null;
  }
  return api('me');
}

function noAccount(main, me) {
  if (me && me.user && me.user.isAdmin) {
    main.innerHTML =
      '<p class="portal-empty">You are signed in as the engineer. This address is not on a client account, so the client pages are empty. The work is on the admin pages.</p>' +
      '<div class="portal-actions"><a class="btn" href="/portal/admin/">Accounts and leads</a> <a class="btn-quiet" href="/portal/admin/availability/">Availability</a></div>';
    return;
  }
  main.innerHTML =
    '<p class="portal-empty">No account for this address yet. Book a call, and we will invite you after it.</p>' +
    '<div class="portal-actions"><a class="btn" href="/book/">Book a 20-minute call</a></div>';
}

async function renderDashboard(me) {
  const main = shell(me.user, 'Today', me.account ? accountLine(me.account) : 'What is waiting, and what the agents did.');
  if (!me.account) return noAccount(main, me);
  const data = await api('home');
  const upcoming = data.upcoming;
  const nextFig = upcoming
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(upcoming.start))
    : 'None';
  const nextText = upcoming
    ? esc(upcoming.when) + '. ' + esc(label(upcoming.type)) + '. <a href="/portal/meetings/">Meetings</a>'
    : 'No call on the books. <a href="/portal/meetings/">Meetings</a>';
  const waiting = (data.approvals || []).length;
  const open = (data.requests || []).length;
  const agents = (data.agents || []).map(function (a) {
    return ledgerRow(a.name, statusClass(a.status), label(a.status), esc(a.chore));
  }).join('');
  const activity = (data.activity || []).map(function (row) {
    return ledgerRow(whenLabel(row.ts), statusClass(row.type), label(row.type), activityEntry(row));
  }).join('');
  main.innerHTML =
    '<ul class="figures">' +
    '<li><span class="fig">' + esc(nextFig) + '</span><p>' + nextText + '</p></li>' +
    '<li><span class="fig">' + waiting + '</span><p>' + (waiting === 0 ? 'Nothing is waiting on you.' : (waiting === 1 ? 'Approval is waiting.' : 'Approvals are waiting.')) + ' <a href="/portal/approvals/">Approvals</a></p></li>' +
    '<li><span class="fig">' + open + '</span><p>' + (open === 0 ? 'No open requests.' : (open === 1 ? 'Open request.' : 'Open requests.')) + ' <a href="/portal/requests/">Requests</a></p></li>' +
    '</ul>' +
    '<h2>Agents</h2>' + (agents ? ledger(agents) : empty('No agents yet. They show up here as they are set up.')) +
    '<h2>Latest</h2>' + (activity ? ledger(activity) : empty('Nothing posted yet.'));
}

async function renderActivity(me) {
  const main = shell(me.user, 'Activity', 'What the agents did, and who signed off.');
  if (!me.account) return noAccount(main, me);
  async function load() {
    const type = document.getElementById('filter-type').value;
    const agent = document.getElementById('filter-agent').value;
    const q = new URLSearchParams();
    if (type) q.set('type', type);
    if (agent) q.set('agent', agent);
    try {
      const data = await api('activity' + (q.toString() ? '?' + q.toString() : ''));
      const rows = (data.activity || []).map(function (row) {
        return ledgerRow(whenLabel(row.ts), statusClass(row.type), label(row.type), activityEntry(row));
      }).join('');
      document.getElementById('activity-list').innerHTML = rows ? ledger(rows) : empty('Nothing in this view.');
    } catch (e) {
      document.getElementById('activity-list').innerHTML = '<p class="desk-status">' + esc(e.message) + '</p>';
    }
  }
  const first = await api('activity');
  const options = (first.agents || []).map(function (a) {
    return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>';
  }).join('');
  main.innerHTML =
    '<div class="portal-filters"><label>Type <select id="filter-type"><option value="">All</option>' +
    '<option value="did">Done</option><option value="needs_approval">Waiting on you</option>' +
    '<option value="blocked">Blocked</option><option value="error">Error</option><option value="note">Note</option></select></label>' +
    '<label>Agent <select id="filter-agent"><option value="">All</option>' + options + '</select></label></div>' +
    '<div id="activity-list"></div>';
  document.getElementById('filter-type').addEventListener('change', load);
  document.getElementById('filter-agent').addEventListener('change', load);
  await load();
}

async function renderAgents(me) {
  const main = shell(me.user, 'Agents', 'The chores this office handed over.');
  if (!me.account) return noAccount(main, me);
  const data = await api('agents');
  const rows = (data.agents || []).map(function (a) {
    const key = a.last4 ? '<p class="ledger-detail">Key ending in ' + esc(a.last4) + '.</p>' : '';
    return ledgerRow(a.name, statusClass(a.status), label(a.status), esc(a.chore) + key);
  }).join('');
  main.innerHTML = rows ? ledger(rows) : empty('No agents yet. They show up here as they are set up.');
}

async function renderApprovals(me) {
  const main = shell(me.user, 'Approvals', 'A person signs off before a new kind of message goes out.');
  if (!me.account) return noAccount(main, me);
  const data = await api('approvals');
  const items = data.approvals || [];
  main.innerHTML = items.length
    ? '<figure class="record ledger"><table><tbody id="approvals"></tbody></table></figure><p class="desk-status" id="approval-error" hidden></p>'
    : empty('Nothing is waiting on you.');
  const list = document.getElementById('approvals');
  if (!list) return;
  items.forEach(function (item) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<th>' + esc(whenLabel(item.createdAt)) + '</th><td class="status waiting">Waiting</td><td></td>';
    const entry = tr.lastElementChild;
    const summary = document.createElement('p');
    summary.textContent = item.summary || '';
    const actions = document.createElement('div');
    actions.className = 'portal-actions';
    ['approved', 'declined'].forEach(function (decision) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = decision === 'approved' ? 'btn' : 'btn-quiet';
      btn.textContent = decision === 'approved' ? 'Approve' : 'Decline';
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        try {
          await api('approvals', { method: 'POST', body: { id: item.id, decision: decision } });
          tr.remove();
          if (!list.children.length) {
            list.closest('.ledger').replaceWith(Object.assign(document.createElement('p'), {
              className: 'portal-empty',
              textContent: 'Nothing is waiting on you.',
            }));
          }
        } catch (e) {
          btn.disabled = false;
          const err = document.getElementById('approval-error');
          err.hidden = false;
          err.textContent = e.message;
        }
      });
      actions.appendChild(btn);
    });
    entry.appendChild(summary);
    entry.appendChild(actions);
    list.appendChild(tr);
  });
}

async function renderRequests(me) {
  const main = shell(me.user, 'Requests', 'Say what should change.');
  if (!me.account) return noAccount(main, me);
  const data = await api('requests');
  const rows = (data.requests || []).map(function (r) {
    return ledgerRow(whenLabel(r.createdAt), statusClass(r.status), label(r.status), esc(r.summary));
  }).join('');
  main.innerHTML =
    '<form id="request-form" class="desk-fields"><label class="desk-field desk-field-wide"><span>The change</span><input name="summary" required maxlength="500" placeholder="Stop the review replies. Keep the document chase."></label>' +
    '<div class="desk-field-wide portal-actions"><button class="btn" type="submit">Send</button></div>' +
    '<p class="desk-status desk-field-wide" id="request-error" hidden></p></form>' +
    '<h2>Sent</h2>' + (rows ? ledger(rows) : empty('Nothing sent yet.'));
  document.getElementById('request-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const err = document.getElementById('request-error');
    err.hidden = true;
    try {
      await api('requests', { method: 'POST', body: { summary: new FormData(event.target).get('summary') } });
      location.reload();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
}

function slotButtons(slots, timeZone, onPick) {
  const box = document.createElement('div');
  box.className = 'book-times';
  (slots || []).slice(0, 24).forEach(function (slot) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'book-slot';
    btn.textContent = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(slot.start));
    btn.addEventListener('click', function () { onPick(slot, btn); });
    box.appendChild(btn);
  });
  return box;
}

async function renderMeetings(me) {
  const main = shell(me.user, 'Meetings', 'Checkpoint at day 30, then a call each month.');
  if (!me.account) return noAccount(main, me);
  const data = await api('meetings');
  const rows = (data.meetings || []).map(function (m) {
    const cancel = m.status === 'booked'
      ? '<div class="portal-actions"><button type="button" class="btn-quiet" data-cancel="' + esc(m.id) + '">Cancel</button></div>'
      : '';
    return ledgerRow(m.when || whenLabel(m.start), statusClass(m.status), label(m.status), esc(label(m.type)) + cancel);
  }).join('');
  main.innerHTML =
    (rows ? ledger(rows) : empty('No calls on the books.')) +
    (me.account.status === 'cancelled' ? '' :
      '<h2>Book a checkpoint or a monthly call</h2><div class="portal-actions"><button type="button" class="btn" id="book-checkpoint">Checkpoint</button><button type="button" class="btn-quiet" id="book-monthly">Monthly</button></div><div id="slot-box"></div><p class="desk-status" id="meet-error" hidden></p>');
  main.querySelectorAll('[data-cancel]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        await api('meetings/cancel', { method: 'POST', body: { id: btn.getAttribute('data-cancel') } });
        location.reload();
      } catch (e) {
        btn.disabled = false;
        const err = document.getElementById('meet-error') || document.createElement('p');
        err.hidden = false;
        err.textContent = e.message;
      }
    });
  });
  async function open(type) {
    const err = document.getElementById('meet-error');
    err.hidden = true;
    const box = document.getElementById('slot-box');
    box.innerHTML = '<p class="portal-loading">Loading times.</p>';
    try {
      const slots = await api('meetings/slots?type=' + type);
      box.textContent = '';
      if (!(slots.slots || []).length) {
        box.innerHTML = empty('No open times in the next two weeks.');
        return;
      }
      box.appendChild(slotButtons(slots.slots, slots.timeZone, async function (slot, button) {
        button.disabled = true;
        try {
          const held = await api('meetings/hold', { method: 'POST', body: { type: type, start: slot.start } });
          await api('meetings', { method: 'POST', body: { type: type, start: slot.start, holdToken: held.holdToken } });
          location.reload();
        } catch (e) {
          button.disabled = false;
          err.hidden = false;
          err.textContent = e.message;
        }
      }));
    } catch (e) {
      box.textContent = '';
      err.hidden = false;
      err.textContent = e.message;
    }
  }
  const checkpoint = document.getElementById('book-checkpoint');
  if (checkpoint) checkpoint.addEventListener('click', function () { open('checkpoint'); });
  const monthly = document.getElementById('book-monthly');
  if (monthly) monthly.addEventListener('click', function () { open('monthly'); });
}

async function renderBilling(me) {
  const main = shell(me.user, 'Billing', me.account ? accountLine(me.account) : 'Invoices, the card, and the monthly charge.');
  if (!me.account) return noAccount(main, me);
  const status = new URLSearchParams(location.search).get('status');
  const banner = status === 'success'
    ? '<p class="notice">Payment received. The account updates when Stripe confirms it.</p>'
    : (status === 'cancel' ? '<p class="notice">The payment was not completed.</p>' : '');
  const active = me.account.billingStatus === 'active' || me.account.billingStatus === 'trialing';
  main.innerHTML = banner +
    '<p class="bill-line"><b>$5,000</b> to set up, then <b>$1,000 a month</b>. The setup is on the first invoice only.</p>' +
    '<div class="portal-actions"><button class="btn" id="pay" type="button"' + (active ? ' hidden' : '') + '>Pay $5,000 and start the month</button>' +
    '<button class="btn-quiet" id="manage-bill" type="button">Invoices and card</button></div>' +
    '<p class="desk-status" id="bill-error" hidden></p>';
  async function go(path, button) {
    const err = document.getElementById('bill-error');
    err.hidden = true;
    button.disabled = true;
    try {
      const data = await api(path, { method: 'POST', body: {} });
      if (data.url) location.href = data.url;
    } catch (e) {
      button.disabled = false;
      err.hidden = false;
      err.textContent = e.message;
    }
  }
  const pay = document.getElementById('pay');
  if (pay) pay.addEventListener('click', function () { go('billing/checkout', pay); });
  document.getElementById('manage-bill').addEventListener('click', function (event) {
    go('billing/portal', event.target);
  });
}

async function renderAccount(me) {
  const main = shell(me.user, 'Account', me.account ? me.account.kind : 'The people on this account, and who gets the weekly note.');
  if (!me.account) return noAccount(main, me);
  const owner = me.account.role === 'owner';
  const meMember = (me.account.members || []).find(function (m) { return m.email === me.user.email; });
  const rows = (me.account.members || []).map(function (m) {
    const remove = owner && m.role !== 'owner'
      ? '<div class="portal-actions"><button type="button" class="btn-quiet" data-remove="' + esc(m.email) + '">Remove</button></div>'
      : '';
    return ledgerRow(m.name || m.email, '', label(m.role), esc(m.email) + remove);
  }).join('');
  main.innerHTML =
    (rows ? ledger(rows) : empty('No one is on this account yet.')) +
    '<label class="portal-check"><input type="checkbox" id="digest"' + (meMember && meMember.digest !== false ? ' checked' : '') + '> Email me the weekly note and the monthly report</label>' +
    (owner
      ? '<h2>Invite someone</h2><form id="invite" class="desk-fields"><label class="desk-field"><span>Name</span><input name="name"></label><label class="desk-field"><span>Email</span><input type="email" name="email" required></label><div class="desk-field-wide portal-actions"><button class="btn" type="submit">Send invite</button></div><p class="desk-status desk-field-wide" id="invite-error" hidden></p></form>'
      : '') +
    '<p class="desk-status" id="account-error" hidden></p>';
  document.getElementById('digest').addEventListener('change', function (event) {
    api('members/digest', { method: 'POST', body: { digest: event.target.checked } });
  });
  main.querySelectorAll('[data-remove]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        await api('members/remove', { method: 'POST', body: { email: btn.getAttribute('data-remove') } });
        location.reload();
      } catch (e) {
        btn.disabled = false;
        const err = document.getElementById('account-error');
        err.hidden = false;
        err.textContent = e.message;
      }
    });
  });
  const invite = document.getElementById('invite');
  if (invite) invite.addEventListener('submit', async function (event) {
    event.preventDefault();
    const err = document.getElementById('invite-error');
    err.hidden = true;
    const fd = new FormData(invite);
    try {
      await api('members', { method: 'POST', body: { name: fd.get('name'), email: fd.get('email') } });
      location.reload();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
}

async function renderReports(me) {
  const main = shell(me.user, 'Reports', 'Written at the start of the month, from the activity log.');
  if (!me.account) return noAccount(main, me);
  const month = new URLSearchParams(location.search).get('month') || '';
  const data = await api('reports');
  const reports = data.reports || [];
  const current = reports.find(function (r) { return r.month === month; }) || reports[0];
  if (!reports.length) {
    main.innerHTML = empty('No report yet. The first one is written at the start of the next month.');
    return;
  }
  main.innerHTML =
    '<div class="book-days">' + reports.map(function (r) {
      const on = current && r.month === current.month;
      return '<a class="book-slot' + (on ? ' is-on' : '') + '" href="/portal/reports/?month=' + esc(r.month) + '"' +
        (on ? ' aria-current="page"' : '') + '>' + esc(monthLabel(r.month)) + '</a>';
    }).join('') + '</div>' +
    (current
      ? '<h2>' + esc(monthLabel(current.month)) + '</h2><p class="portal-empty">' + esc(current.total || 0) + ' updates.</p>' +
        ((current.highlights || []).length
          ? '<ul class="posture">' + current.highlights.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>'
          : '')
      : empty('No report yet. The first one is written at the start of the next month.'));
}

async function renderAdmin(me) {
  const main = shell(me.user, 'Admin', 'Create an account after a call. Leads from the form and the calendar land here.');
  const data = await api('admin/accounts');
  const accounts = (data.accounts || []).map(function (a) {
    return ledgerRow(
      { html: '<a href="/portal/admin/account/?id=' + esc(a.id) + '">' + esc(a.office) + '</a>' },
      statusClass(a.billingStatus),
      label(a.billingStatus || 'none'),
      esc(a.kind) + '. ' + esc(label(a.status)) + '.',
    );
  }).join('');
  const leads = (data.leads || []).map(function (l) {
    const source = l.source === 'book' ? 'Calendar' : (l.source ? 'Form' : 'Lead');
    const detail = [l.business, l.chore || l.intent].filter(Boolean).join('. ');
    const labelName = l.name || l.email || 'Lead';
    const bits = [];
    if (l.email && l.email !== labelName) bits.push(l.email);
    if (detail) bits.push(detail);
    const who = '<b>' + esc(labelName) + '</b>' + (bits.length ? '<p class="ledger-detail">' + esc(bits.join('. ')) + '.</p>' : '');
    return ledgerRow(whenLabel(l.start || l.createdAt), '', source, who);
  }).join('');
  main.innerHTML =
    '<h2>New account</h2>' +
    '<form id="new-account" class="desk-fields">' +
    '<label class="desk-field"><span>Business</span><input name="office" required></label>' +
    '<label class="desk-field"><span>Kind</span><select name="kind" required><option value="" selected>Choose one</option><option>law firm</option><option>dental practice or med spa</option><option>real estate office</option><option>CPA firm</option><option>owner-run office</option></select></label>' +
    '<label class="desk-field"><span>Owner name</span><input name="name" required></label>' +
    '<label class="desk-field"><span>Owner email</span><input type="email" name="email" required></label>' +
    '<div class="desk-field-wide portal-actions"><button class="btn" type="submit">Create and invite</button></div>' +
    '<p class="desk-status desk-field-wide" id="admin-error" hidden></p></form>' +
    '<section class="portal-section"><h2>Accounts</h2>' +
    (accounts ? ledger(accounts) : empty('No accounts yet. The first one is created with the form above, after a call.')) +
    '</section>' +
    '<section class="portal-section"><h2>Leads</h2>' +
    (leads ? ledger(leads, ['When', 'Source', 'Lead']) : empty('No leads yet. Inquiries from the Studio form and bookings from the calendar appear here.')) +
    '</section>' +
    '<p class="portal-more"><a href="/portal/admin/availability/">Availability</a></p>';
  document.getElementById('new-account').addEventListener('submit', async function (event) {
    event.preventDefault();
    const err = document.getElementById('admin-error');
    err.hidden = true;
    const fd = new FormData(event.target);
    try {
      const created = await api('admin/accounts', {
        method: 'POST',
        body: { office: fd.get('office'), kind: fd.get('kind'), name: fd.get('name'), email: fd.get('email') },
      });
      location.href = '/portal/admin/account/?id=' + created.account.id;
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
}

async function renderAdminAccount(me) {
  const id = new URLSearchParams(location.search).get('id') || '';
  const main = shell(me.user, 'Account', '');
  if (!id) {
    main.innerHTML = '<p class="desk-status">Missing account.</p>';
    return;
  }
  const data = await api('admin/accounts/' + encodeURIComponent(id));
  const acc = data.account;
  setHead(acc.office, acc.kind + '. ' + label(acc.status) + '. Billing ' + label(acc.billingStatus || 'none').toLowerCase() + '.');
  const agents = (data.agents || []).map(function (a) {
    const next = a.status === 'running' ? 'paused' : 'running';
    const verb = a.status === 'running' ? 'Pause' : 'Mark running';
    return ledgerRow(
      a.name,
      statusClass(a.status),
      label(a.status),
      esc(a.chore) + '<div class="portal-actions"><button type="button" class="btn-quiet" data-status="' + esc(a.id) + '" data-next="' + next + '">' + verb + '</button></div>',
    );
  }).join('');
  const pending = (data.approvals || []).filter(function (a) { return a.status === 'pending'; });
  const approvals = pending.map(function (a) {
    return ledgerRow(whenLabel(a.createdAt), 'waiting', 'Waiting', esc(a.summary) + '<div class="portal-actions"><button class="btn" type="button" data-approve="' + esc(a.id) + '">Approve</button></div>');
  }).join('');
  const requests = (data.requests || []).map(function (r) {
    const done = r.status === 'open'
      ? '<div class="portal-actions"><button class="btn-quiet" type="button" data-done="' + esc(r.id) + '">Mark done</button></div>'
      : '';
    return ledgerRow(whenLabel(r.createdAt), statusClass(r.status), label(r.status), esc(r.summary) + done);
  }).join('');
  main.innerHTML =
    '<form id="reply" class="desk-fields"><label class="desk-field desk-field-wide"><span>Reply time shown on the account</span><input name="replyTime" value="' + esc(acc.replyTime || '') + '" placeholder="Weekdays, within one business day"></label>' +
    '<div class="desk-field-wide portal-actions"><button class="btn" type="submit">Save</button><p class="saved" id="reply-ok" hidden>Saved.</p></div></form>' +
    '<section class="portal-section"><h2>Agents</h2>' + (agents ? ledger(agents) : empty('No agents yet.')) +
    '<form id="new-agent" class="desk-fields"><label class="desk-field"><span>Name</span><input name="name" required></label><label class="desk-field"><span>Chore</span><input name="chore" required></label><div class="desk-field-wide portal-actions"><button class="btn" type="submit">Create agent</button></div></form>' +
    '<p class="key-once" id="new-key" hidden></p></section>' +
    '<section class="portal-section"><h2>Note</h2><form id="note" class="desk-fields"><label class="desk-field desk-field-wide"><span>What happened</span><input name="summary" required></label><div class="desk-field-wide portal-actions"><button class="btn" type="submit">Post to the activity log</button></div></form></section>' +
    '<section class="portal-section"><h2>Approvals</h2>' + (approvals ? ledger(approvals) : empty('Nothing is waiting.')) + '</section>' +
    '<section class="portal-section"><h2>Requests</h2>' + (requests ? ledger(requests) : empty('No requests.')) + '</section>' +
    '<div class="portal-actions"><button class="btn-quiet" type="button" id="gen-report">Write this month’s report</button></div>' +
    '<p class="desk-status" id="acc-error" hidden></p>';
  const err = document.getElementById('acc-error');
  function show(e) { err.hidden = false; err.textContent = e.message; }
  document.getElementById('reply').addEventListener('submit', async function (event) {
    event.preventDefault();
    err.hidden = true;
    try {
      await api('admin/reply', { method: 'POST', body: { accountId: id, replyTime: new FormData(event.target).get('replyTime') } });
      document.getElementById('reply-ok').hidden = false;
    } catch (e) { show(e); }
  });
  document.getElementById('new-agent').addEventListener('submit', async function (event) {
    event.preventDefault();
    err.hidden = true;
    const fd = new FormData(event.target);
    try {
      const created = await api('admin/agents', { method: 'POST', body: { accountId: id, name: fd.get('name'), chore: fd.get('chore') } });
      const key = document.getElementById('new-key');
      key.hidden = false;
      key.textContent = 'Copy this key now. It is not shown again. ' + created.agent.apiKey;
    } catch (e) { show(e); }
  });
  main.querySelectorAll('[data-status]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await api('admin/agents/status', { method: 'POST', body: { accountId: id, agentId: btn.getAttribute('data-status'), status: btn.getAttribute('data-next') } });
        location.reload();
      } catch (e) { show(e); }
    });
  });
  document.getElementById('note').addEventListener('submit', async function (event) {
    event.preventDefault();
    err.hidden = true;
    try {
      await api('admin/notes', { method: 'POST', body: { accountId: id, summary: new FormData(event.target).get('summary') } });
      location.reload();
    } catch (e) { show(e); }
  });
  main.querySelectorAll('[data-approve]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await api('admin/approvals', { method: 'POST', body: { accountId: id, id: btn.getAttribute('data-approve'), decision: 'approved' } });
        location.reload();
      } catch (e) { show(e); }
    });
  });
  main.querySelectorAll('[data-done]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await api('admin/requests', { method: 'POST', body: { accountId: id, id: btn.getAttribute('data-done') } });
        location.reload();
      } catch (e) { show(e); }
    });
  });
  document.getElementById('gen-report').addEventListener('click', async function () {
    try {
      await api('admin/reports', { method: 'POST', body: { accountId: id } });
      location.href = '/portal/reports/';
    } catch (e) { show(e); }
  });
}

async function renderAvailability(me) {
  const main = shell(me.user, 'Availability', 'Leave a day blank to keep it closed. Hours look like 10:00.');
  const data = await api('admin/availability');
  const a = data.availability;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const byDay = {};
  (a.windows || []).forEach(function (w) { byDay[w.dow] = w; });
  main.innerHTML =
    '<form id="avail" class="desk-fields">' +
    '<label class="desk-field"><span>Time zone</span><input name="timeZone" value="' + esc(a.timeZone) + '" required></label>' +
    '<label class="desk-field"><span>Buffer, minutes</span><input name="bufferMin" type="number" min="0" max="120" value="' + esc(a.bufferMin) + '"></label>' +
    '<label class="desk-field"><span>Discovery, minutes</span><input name="discovery" type="number" min="10" max="180" value="' + esc(a.durations.discovery) + '"></label>' +
    '<label class="desk-field"><span>Checkpoint, minutes</span><input name="checkpoint" type="number" min="10" max="180" value="' + esc(a.durations.checkpoint) + '"></label>' +
    '<label class="desk-field"><span>Monthly, minutes</span><input name="monthly" type="number" min="10" max="180" value="' + esc(a.durations.monthly) + '"></label>' +
    days.map(function (name, i) {
      const w = byDay[i] || { start: '', end: '' };
      return '<div class="desk-field desk-field-wide"><span>' + name + (w.start ? '' : ' (closed)') + '</span><span class="day-times">' +
        '<label class="day-time"><span>Start</span><input type="time" name="start-' + i + '" value="' + esc(w.start) + '" aria-label="' + name + ' start"></label>' +
        '<label class="day-time"><span>End</span><input type="time" name="end-' + i + '" value="' + esc(w.end) + '" aria-label="' + name + ' end"></label>' +
        '</span></div>';
    }).join('') +
    '<label class="desk-field desk-field-wide"><span>Closed dates, one YYYY-MM-DD per line</span><textarea name="closed" rows="4">' +
    esc((a.exceptions || []).filter(function (e) { return e.closed; }).map(function (e) { return e.date; }).join('\n')) +
    '</textarea></label>' +
    '<div class="desk-field-wide portal-actions"><button class="btn" type="submit">Save</button><p class="saved" id="avail-ok" hidden>Saved.</p></div>' +
    '<p class="desk-status desk-field-wide" id="avail-error" hidden></p></form>';
  document.getElementById('avail').addEventListener('submit', async function (event) {
    event.preventDefault();
    const err = document.getElementById('avail-error');
    const ok = document.getElementById('avail-ok');
    err.hidden = true;
    ok.hidden = true;
    const fd = new FormData(event.target);
    const windows = [];
    for (let i = 0; i < 7; i++) {
      const start = String(fd.get('start-' + i) || '').trim();
      const end = String(fd.get('end-' + i) || '').trim();
      if (start && end) windows.push({ dow: i, start: start, end: end });
    }
    const exceptions = String(fd.get('closed') || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (date) {
      return { date: date, closed: true };
    });
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
          windows: windows,
          exceptions: exceptions,
        },
      });
      ok.hidden = false;
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
}

const PAGES = {
  login: renderLogin,
  finish: renderFinish,
  dashboard: renderDashboard,
  activity: renderActivity,
  agents: renderAgents,
  approvals: renderApprovals,
  requests: renderRequests,
  meetings: renderMeetings,
  billing: renderBilling,
  account: renderAccount,
  reports: renderReports,
  admin: renderAdmin,
  'admin-account': renderAdminAccount,
  'admin-availability': renderAvailability,
};

async function boot() {
  if (!root || !PAGES[page]) return;
  try {
    if (page === 'login') return renderLogin();
    if (page === 'finish') return renderFinish();
    const me = await session();
    if (!me) return;
    viewer = me;
    if (page.indexOf('admin') === 0 && !me.user.isAdmin) {
      location.href = '/portal/';
      return;
    }
    await PAGES[page](me);
  } catch (e) {
    const main = document.getElementById('portal-main');
    const html = '<p class="desk-status">' + esc(e.message || 'Try again.') + '</p>';
    if (main) main.innerHTML = html;
    else root.innerHTML = '<header class="page-head"><h1>Something went wrong.</h1></header>' + html;
  }
}

boot();
