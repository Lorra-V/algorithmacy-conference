import { api, authApi, esc, getAuth, getConfig, safeNext, waitForUser } from './api.js';

const LINKS = [
  ['dashboard', '/portal/', 'Today'],
  ['activity', '/portal/activity/', 'Activity'],
  ['agents', '/portal/agents/', 'Agents'],
  ['approvals', '/portal/approvals/', 'Approvals'],
  ['requests', '/portal/requests/', 'Requests'],
  ['meetings', '/portal/meetings/', 'Meetings'],
  ['billing', '/portal/billing/', 'Billing'],
  ['account', '/portal/account/', 'Account'],
  ['reports', '/portal/reports/', 'Reports'],
];

const root = document.getElementById('portal');
const page = root ? root.dataset.page : '';

function el(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box;
}

function shell(user, title) {
  const admin = user.isAdmin ? '<a href="/portal/admin/"' + (page.indexOf('admin') === 0 ? ' aria-current="page"' : '') + '>Admin</a>' : '';
  const links = LINKS.map(function (item) {
    const current = item[0] === page ? ' aria-current="page"' : '';
    return '<a href="' + item[1] + '"' + current + '>' + item[2] + '</a>';
  }).join('');
  root.innerHTML =
    '<header class="portal-top"><a class="portal-brand" href="/portal/">Algorithmacy Studio</a>' +
    '<nav class="portal-nav" aria-label="Account">' + links + admin +
    '<button type="button" class="btn-ghost" id="sign-out">Sign out</button></nav></header>' +
    '<h1>' + esc(title) + '</h1><div id="portal-main"></div>';
  document.getElementById('sign-out').addEventListener('click', async function () {
    const auth = await getAuth();
    if (auth) await authApi().signOut(auth);
    location.href = '/portal/login/';
  });
  return document.getElementById('portal-main');
}

function loginNext() {
  return safeNext(new URLSearchParams(location.search).get('next') || '/portal/');
}

async function renderLogin() {
  const cfg = await getConfig();
  const email = new URLSearchParams(location.search).get('email') || '';
  root.innerHTML =
    '<header class="portal-top"><a class="portal-brand" href="/studio">Algorithmacy Studio</a>' +
    '<nav class="portal-nav"><a href="/studio">The offer</a><a href="/book/">Book a call</a></nav></header>' +
    '<h1>Sign in.</h1>' +
    (cfg.configured ? '' : '<p class="error">Sign-in is not open yet. Write to roger@algorithmacy.org.</p>') +
    '<form class="stack" id="login-form" style="max-width:420px">' +
    '<label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email" value="' + esc(email) + '"></label>' +
    '<p class="book-hp" hidden><input name="website" tabindex="-1" autocomplete="off"></p>' +
    '<button class="btn" type="submit">Email me a link</button>' +
    '<p class="error" id="login-error" hidden></p>' +
    '<p class="muted" id="login-note"></p>' +
    (cfg.configured ? '<button class="btn-ghost" type="button" id="google">Continue with Google</button>' : '') +
    '</form>';
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
      const note = document.getElementById('login-note');
      note.textContent = data.sent
        ? 'The link is on its way. It works once.'
        : 'No account for that address yet. Book a call, and we will invite you after it.';
      if (!data.sent) note.innerHTML += ' <a href="/book/">Book a 20-minute call</a>';
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
  const google = document.getElementById('google');
  if (google) google.addEventListener('click', async function () {
    const err = document.getElementById('login-error');
    try {
      const auth = await getAuth();
      const fns = authApi();
      await fns.signInWithPopup(auth, new fns.GoogleAuthProvider());
      location.href = loginNext();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message || 'Google sign-in did not finish.';
    }
  });
}

async function renderFinish() {
  root.innerHTML = '<h1>Signing in.</h1><p class="muted" id="finish-note">Checking the link.</p>';
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
    root.innerHTML = '<h1>Sign-in is not open yet.</h1><p class="muted">Write to roger@algorithmacy.org.</p>';
    return null;
  }
  const user = await waitForUser(auth);
  if (!user) {
    location.href = '/portal/login/?next=' + encodeURIComponent(location.pathname + location.search);
    return null;
  }
  const me = await api('me');
  return me;
}

function noAccount(main) {
  main.innerHTML = '<p class="lede">No account for this address yet. Book a call, and we will invite you after it.</p><p><a class="btn" href="/book/">Book a 20-minute call</a></p>';
}

async function renderDashboard(me) {
  const main = shell(me.user, me.account ? me.account.office : 'Studio');
  if (!me.account) return noAccount(main);
  const data = await api('home');
  const upcoming = data.upcoming
    ? '<p>' + esc(data.upcoming.when) + '</p><p class="muted">' + esc(data.upcoming.type) + '</p>'
    : '<p class="muted">No call on the books.</p>';
  const agents = (data.agents || []).map(function (a) {
    return '<li><strong>' + esc(a.name) + '</strong> · ' + esc(a.chore) + ' · ' + esc(a.status) + '</li>';
  }).join('') || '<li>No agents yet. They show up here as they are set up.</li>';
  const activity = (data.activity || []).map(function (row) {
    return '<li>' + esc(row.summary) + '</li>';
  }).join('') || '<li>Nothing posted yet.</li>';
  main.innerHTML =
    '<p class="pill">' + esc(data.account.status) + ' · billing ' + esc(data.account.billingStatus) + '</p>' +
    (data.account.replyTime ? '<p class="muted">Reply time: ' + esc(data.account.replyTime) + '</p>' : '') +
    '<div class="cards">' +
    '<article class="card"><h2>Next call</h2>' + upcoming + '<p><a href="/portal/meetings/">Meetings</a></p></article>' +
    '<article class="card"><h2>Waiting on you</h2><p>' + (data.approvals || []).length + ' approval' + ((data.approvals || []).length === 1 ? '' : 's') + '</p><p><a href="/portal/approvals/">Approvals</a></p></article>' +
    '<article class="card"><h2>Open requests</h2><p>' + (data.requests || []).length + '</p><p><a href="/portal/requests/">Say what should change</a></p></article>' +
    '</div>' +
    '<h2>Agents</h2><ul class="list">' + agents + '</ul>' +
    '<h2>Latest</h2><ul class="list">' + activity + '</ul>';
}

async function renderActivity(me) {
  const main = shell(me.user, 'Activity');
  if (!me.account) return noAccount(main);
  async function load() {
    const type = document.getElementById('filter-type').value;
    const agent = document.getElementById('filter-agent').value;
    const q = new URLSearchParams();
    if (type) q.set('type', type);
    if (agent) q.set('agent', agent);
    const data = await api('activity' + (q.toString() ? '?' + q.toString() : ''));
    const list = document.getElementById('activity-list');
    list.innerHTML = (data.activity || []).map(function (row) {
      return '<li><span class="pill">' + esc(row.type) + '</span> ' + esc(row.summary) +
        (row.detail ? '<p>' + esc(row.detail) + '</p>' : '') +
        '<p class="muted">' + esc(row.ts) + (row.approvedBy ? ' · signed off by ' + esc(row.approvedBy) : '') + '</p></li>';
    }).join('') || '<li>Nothing in this view.</li>';
  }
  const first = await api('activity');
  const options = (first.agents || []).map(function (a) {
    return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>';
  }).join('');
  main.innerHTML =
    '<div class="filters"><label>Type <select id="filter-type"><option value="">All</option><option>did</option><option>needs_approval</option><option>blocked</option><option>error</option><option>note</option></select></label>' +
    '<label>Agent <select id="filter-agent"><option value="">All</option>' + options + '</select></label></div>' +
    '<ul class="list" id="activity-list"></ul>';
  document.getElementById('filter-type').addEventListener('change', load);
  document.getElementById('filter-agent').addEventListener('change', load);
  await load();
}

async function renderAgents(me) {
  const main = shell(me.user, 'Agents');
  if (!me.account) return noAccount(main);
  const data = await api('agents');
  main.innerHTML = '<ul class="list">' + ((data.agents || []).map(function (a) {
    return '<li><strong>' + esc(a.name) + '</strong><p>' + esc(a.chore) + '</p><p class="muted">' + esc(a.status) + (a.last4 ? ' · key ···' + esc(a.last4) : '') + '</p></li>';
  }).join('') || '<li>No agents yet.</li>') + '</ul>';
}

async function renderApprovals(me) {
  const main = shell(me.user, 'Approvals');
  if (!me.account) return noAccount(main);
  const data = await api('approvals');
  const items = data.approvals || [];
  main.innerHTML = items.length ? '<ul class="list" id="approvals"></ul>' : '<p class="empty muted">Nothing is waiting on you.</p>';
  const list = document.getElementById('approvals');
  if (!list) return;
  items.forEach(function (item) {
    const li = document.createElement('li');
    li.innerHTML = '<p>' + esc(item.summary) + '</p><div class="row"></div>';
    ['approved', 'declined'].forEach(function (decision) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = decision === 'approved' ? 'btn' : 'btn-ghost';
      btn.textContent = decision === 'approved' ? 'Approve' : 'Decline';
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        await api('approvals', { method: 'POST', body: { id: item.id, decision: decision } });
        li.remove();
        if (!list.children.length) main.innerHTML += '<p class="muted">Nothing is waiting on you.</p>';
      });
      li.querySelector('.row').appendChild(btn);
    });
    list.appendChild(li);
  });
}

async function renderRequests(me) {
  const main = shell(me.user, 'What should change');
  if (!me.account) return noAccount(main);
  const data = await api('requests');
  main.innerHTML =
    '<form id="request-form"><label class="field"><span>The change</span><input name="summary" required maxlength="500" placeholder="Stop the review replies. Keep the document chase."></label><button class="btn" type="submit">Send</button><p class="error" id="request-error" hidden></p></form>' +
    '<ul class="list">' + (data.requests || []).map(function (r) {
      return '<li><span class="pill">' + esc(r.status) + '</span> ' + esc(r.summary) + '</li>';
    }).join('') + '</ul>';
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
  box.className = 'filters';
  (slots || []).slice(0, 24).forEach(function (slot) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-ghost';
    btn.textContent = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(slot.start));
    btn.addEventListener('click', function () { onPick(slot, btn); });
    box.appendChild(btn);
  });
  return box;
}

async function renderMeetings(me) {
  const main = shell(me.user, 'Meetings');
  if (!me.account) return noAccount(main);
  const data = await api('meetings');
  main.innerHTML =
    '<ul class="list">' + (data.meetings || []).map(function (m) {
      return '<li data-id="' + esc(m.id) + '"><strong>' + esc(m.when) + '</strong><p>' + esc(m.type) + ' · ' + esc(m.status) + '</p>' +
        (m.status === 'booked' ? '<button type="button" class="btn-ghost" data-cancel="' + esc(m.id) + '">Cancel</button>' : '') +
        '</li>';
    }).join('') + '</ul>' +
    (me.account.status === 'cancelled' ? '' :
      '<h2>Book a checkpoint or a monthly call</h2><div class="filters"><button type="button" class="btn" id="book-checkpoint">Checkpoint</button><button type="button" class="btn-ghost" id="book-monthly">Monthly</button></div><div id="slot-box"></div><p class="error" id="meet-error" hidden></p>');
  main.querySelectorAll('[data-cancel]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      await api('meetings/cancel', { method: 'POST', body: { id: btn.getAttribute('data-cancel') } });
      location.reload();
    });
  });
  async function open(type) {
    const err = document.getElementById('meet-error');
    err.hidden = true;
    const box = document.getElementById('slot-box');
    box.textContent = 'Loading times.';
    try {
      const slots = await api('meetings/slots?type=' + type);
      box.textContent = '';
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
  const main = shell(me.user, 'Billing');
  if (!me.account) return noAccount(main);
  const status = new URLSearchParams(location.search).get('status');
  const banner = status === 'success'
    ? '<p>Payment received. The account updates when Stripe confirms it.</p>'
    : (status === 'cancel' ? '<p class="muted">The payment was not completed.</p>' : '');
  const active = me.account.billingStatus === 'active' || me.account.billingStatus === 'trialing';
  main.innerHTML = banner +
    '<p class="pill">' + esc(me.account.billingStatus) + '</p>' +
    '<p class="lede">$5,000 to set up, then $1,000 a month. The setup is on the first invoice only.</p>' +
    '<div class="row"><button class="btn" id="pay" type="button"' + (active ? ' hidden' : '') + '>Pay $5,000 and start the month</button>' +
    '<button class="btn-ghost" id="manage-bill" type="button">Invoices and card</button></div>' +
    '<p class="error" id="bill-error" hidden></p>';
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
  const main = shell(me.user, 'Account');
  if (!me.account) return noAccount(main);
  const owner = me.account.role === 'owner';
  const meMember = (me.account.members || []).find(function (m) { return m.email === me.user.email; });
  main.innerHTML =
    '<p class="lede">' + esc(me.account.office) + ' · ' + esc(me.account.kind) + '</p>' +
    '<ul class="list">' + (me.account.members || []).map(function (m) {
      return '<li>' + esc(m.name || m.email) + ' · ' + esc(m.email) + ' · ' + esc(m.role) +
        (owner && m.role !== 'owner' ? ' <button type="button" class="btn-ghost" data-remove="' + esc(m.email) + '">Remove</button>' : '') +
        '</li>';
    }).join('') + '</ul>' +
    '<label class="field"><span><input type="checkbox" id="digest"' + (meMember && meMember.digest !== false ? ' checked' : '') + '> Email me the weekly note and the monthly report</span></label>' +
    (owner ? '<h2>Invite someone</h2><form id="invite"><label class="field"><span>Name</span><input name="name"></label><label class="field"><span>Email</span><input type="email" name="email" required></label><button class="btn" type="submit">Send invite</button><p class="error" id="invite-error" hidden></p></form>' : '');
  document.getElementById('digest').addEventListener('change', function (event) {
    api('members/digest', { method: 'POST', body: { digest: event.target.checked } });
  });
  main.querySelectorAll('[data-remove]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await api('members/remove', { method: 'POST', body: { email: btn.getAttribute('data-remove') } });
      location.reload();
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
  const main = shell(me.user, 'Reports');
  if (!me.account) return noAccount(main);
  const month = new URLSearchParams(location.search).get('month') || '';
  const data = await api('reports');
  const reports = data.reports || [];
  const current = reports.find(function (r) { return r.month === month; }) || reports[0];
  main.innerHTML =
    '<div class="filters">' + reports.map(function (r) {
      return '<a class="btn-ghost" href="/portal/reports/?month=' + esc(r.month) + '">' + esc(r.month) + '</a>';
    }).join('') + '</div>' +
    (current
      ? '<article class="card"><h2>' + esc(current.month) + '</h2><p>' + esc(current.total || 0) + ' updates.</p><ul class="list">' +
        (current.highlights || []).map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul></article>'
      : '<p class="muted">No report yet. The first one is written at the start of the next month.</p>');
}

async function renderAdmin(me) {
  const main = shell(me.user, 'Accounts');
  const data = await api('admin/accounts');
  main.innerHTML =
    '<form id="new-account" class="card"><h2>New account</h2>' +
    '<label class="field"><span>Business</span><input name="office" required></label>' +
    '<label class="field"><span>Kind</span><select name="kind"><option>law firm</option><option>dental practice or med spa</option><option>real estate office</option><option>CPA firm</option><option>owner-run office</option></select></label>' +
    '<label class="field"><span>Owner name</span><input name="name" required></label>' +
    '<label class="field"><span>Owner email</span><input type="email" name="email" required></label>' +
    '<button class="btn" type="submit">Create and invite</button><p class="error" id="admin-error" hidden></p></form>' +
    '<h2>Accounts</h2><ul class="list">' + (data.accounts || []).map(function (a) {
      return '<li><a href="/portal/admin/account/?id=' + esc(a.id) + '">' + esc(a.office) + '</a><p class="muted">' + esc(a.kind) + ' · ' + esc(a.status) + ' · ' + esc(a.billingStatus || 'none') + '</p></li>';
    }).join('') + '</ul>' +
    '<h2>Leads</h2><ul class="list">' + (data.leads || []).map(function (l) {
      return '<li>' + esc(l.name) + ' · ' + esc(l.email) + '<p>' + esc(l.business || '') + ' · ' + esc(l.chore || l.intent || '') + '</p></li>';
    }).join('') + '</ul>' +
    '<p><a href="/portal/admin/availability/">Availability</a></p>';
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
  const main = shell(me.user, 'Account');
  if (!id) { main.innerHTML = '<p class="error">Missing account.</p>'; return; }
  const data = await api('admin/accounts/' + encodeURIComponent(id));
  const acc = data.account;
  main.innerHTML =
    '<p class="lede">' + esc(acc.office) + ' · ' + esc(acc.kind) + ' · ' + esc(acc.status) + ' · billing ' + esc(acc.billingStatus || 'none') + '</p>' +
    '<form id="reply"><label class="field"><span>Reply time shown on the account</span><input name="replyTime" value="' + esc(acc.replyTime || '') + '" placeholder="Weekdays, within one business day"></label><button class="btn" type="submit">Save</button></form>' +
    '<h2>Agents</h2><ul class="list" id="agent-list">' + (data.agents || []).map(function (a) {
      return '<li>' + esc(a.name) + ' · ' + esc(a.chore) + ' · ' + esc(a.status) +
        ' <button type="button" class="btn-ghost" data-status="' + esc(a.id) + '" data-next="' + (a.status === 'running' ? 'paused' : 'running') + '">' + (a.status === 'running' ? 'Pause' : 'Mark running') + '</button></li>';
    }).join('') + '</ul>' +
    '<form id="new-agent"><label class="field"><span>Name</span><input name="name" required></label><label class="field"><span>Chore</span><input name="chore" required></label><button class="btn" type="submit">Create agent</button></form>' +
    '<p class="key-once" id="new-key" hidden></p>' +
    '<h2>Note</h2><form id="note"><label class="field"><span>What happened</span><input name="summary" required></label><button class="btn" type="submit">Post to the activity log</button></form>' +
    '<h2>Approvals</h2><ul class="list">' + (data.approvals || []).filter(function (a) { return a.status === 'pending'; }).map(function (a) {
      return '<li>' + esc(a.summary) + ' <button class="btn" type="button" data-approve="' + esc(a.id) + '">Approve</button></li>';
    }).join('') + '</ul>' +
    '<h2>Requests</h2><ul class="list">' + (data.requests || []).map(function (r) {
      return '<li>' + esc(r.summary) + ' · ' + esc(r.status) +
        (r.status === 'open' ? ' <button class="btn-ghost" type="button" data-done="' + esc(r.id) + '">Mark done</button>' : '') + '</li>';
    }).join('') + '</ul>' +
    '<p><button class="btn-ghost" type="button" id="gen-report">Write this month’s report</button></p>' +
    '<p class="error" id="acc-error" hidden></p>';
  const err = document.getElementById('acc-error');
  function show(e) { err.hidden = false; err.textContent = e.message; }
  document.getElementById('reply').addEventListener('submit', async function (event) {
    event.preventDefault();
    try {
      await api('admin/reply', { method: 'POST', body: { accountId: id, replyTime: new FormData(event.target).get('replyTime') } });
    } catch (e) { show(e); }
  });
  document.getElementById('new-agent').addEventListener('submit', async function (event) {
    event.preventDefault();
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
    try {
      await api('admin/notes', { method: 'POST', body: { accountId: id, summary: new FormData(event.target).get('summary') } });
      location.reload();
    } catch (e) { show(e); }
  });
  main.querySelectorAll('[data-approve]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await api('admin/approvals', { method: 'POST', body: { accountId: id, id: btn.getAttribute('data-approve'), decision: 'approved' } });
      location.reload();
    });
  });
  main.querySelectorAll('[data-done]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await api('admin/requests', { method: 'POST', body: { accountId: id, id: btn.getAttribute('data-done') } });
      location.reload();
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
  const main = shell(me.user, 'Availability');
  const data = await api('admin/availability');
  const a = data.availability;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDay = {};
  (a.windows || []).forEach(function (w) { byDay[w.dow] = w; });
  main.innerHTML =
    '<form id="avail">' +
    '<label class="field"><span>Time zone</span><input name="timeZone" value="' + esc(a.timeZone) + '" required></label>' +
    '<label class="field"><span>Buffer, minutes</span><input name="bufferMin" type="number" min="0" max="120" value="' + esc(a.bufferMin) + '"></label>' +
    '<label class="field"><span>Discovery, minutes</span><input name="discovery" type="number" min="10" max="180" value="' + esc(a.durations.discovery) + '"></label>' +
    '<label class="field"><span>Checkpoint, minutes</span><input name="checkpoint" type="number" min="10" max="180" value="' + esc(a.durations.checkpoint) + '"></label>' +
    '<label class="field"><span>Monthly, minutes</span><input name="monthly" type="number" min="10" max="180" value="' + esc(a.durations.monthly) + '"></label>' +
    days.map(function (name, i) {
      const w = byDay[i] || { start: '', end: '' };
      return '<label class="field"><span>' + name + '</span><span class="row"><input name="start-' + i + '" value="' + esc(w.start) + '" placeholder="10:00"> <input name="end-' + i + '" value="' + esc(w.end) + '" placeholder="16:00"></span></label>';
    }).join('') +
    '<label class="field"><span>Closed dates, one YYYY-MM-DD per line</span><textarea name="closed" rows="4">' +
    esc((a.exceptions || []).filter(function (e) { return e.closed; }).map(function (e) { return e.date; }).join('\n')) +
    '</textarea></label>' +
    '<button class="btn" type="submit">Save</button><p class="error" id="avail-error" hidden></p><p class="muted" id="avail-ok" hidden>Saved.</p></form>';
  document.getElementById('avail').addEventListener('submit', async function (event) {
    event.preventDefault();
    const err = document.getElementById('avail-error');
    err.hidden = true;
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
      document.getElementById('avail-ok').hidden = false;
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
    if (page.indexOf('admin') === 0 && !me.user.isAdmin) {
      location.href = '/portal/';
      return;
    }
    await PAGES[page](me);
  } catch (e) {
    root.innerHTML = '<h1>Something went wrong.</h1><p class="error">' + esc(e.message || 'Try again.') + '</p>';
  }
}

boot();
