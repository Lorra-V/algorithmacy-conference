import { api, authApi, esc, getAuth, getConfig, safeNext, setPreviewAccount, storeMfa, waitForUser } from './api.js';
import { ensureMfa } from './mfa-ui.js';
import { SAMPLE_ID, bindSampleUser, resetSample, sampleAccount } from './sample.js';

const PRIMARY = [
  ['dashboard', '/portal/', 'Agents'],
  ['billing', '/portal/billing/', 'Subscription'],
  ['meetings', '/portal/meetings/', 'Book a call'],
];

const SETTINGS_PAGES = {
  settings: true,
  activity: true,
  approvals: true,
  requests: true,
  reports: true,
  account: true,
};

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
let page = root ? root.dataset.page : '';
let viewer = null;
let chromeKey = '';
let rendering = false;
let queued = null;

const ROUTES = [
  ['/portal/admin/availability/', 'admin-availability', 'Availability'],
  ['/portal/admin/account/', 'admin-account', 'Account'],
  ['/portal/admin/', 'admin', 'Accounts'],
  ['/portal/settings/', 'settings', 'Settings'],
  ['/portal/activity/', 'activity', 'Activity'],
  ['/portal/agents/', 'agents', 'Agents'],
  ['/portal/approvals/', 'approvals', 'Approvals'],
  ['/portal/requests/', 'requests', 'Requests'],
  ['/portal/meetings/', 'meetings', 'Book a call'],
  ['/portal/reports/', 'reports', 'Monthly report'],
  ['/portal/billing/', 'billing', 'Subscription'],
  ['/portal/account/', 'account', 'People'],
  ['/portal/', 'dashboard', 'Agents'],
];

const ENGINEER_PAGES = {
  admin: true,
  'admin-account': true,
  'admin-availability': true,
};

const VIEW_KEY = 'studioView';
const PREVIEW_KEY = 'studioPreview';
const memoryStore = {};

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

function storeGet(key) {
  try {
    const value = sessionStorage.getItem(key);
    if (value != null) return value;
  } catch (e) { /* private mode */ }
  return memoryStore[key] || '';
}

function storeSet(key, value) {
  memoryStore[key] = value;
  try { sessionStorage.setItem(key, value); } catch (e) { /* private mode */ }
}

function isEngineer(user) {
  return !!(user && user.isAdmin);
}

function viewMode() {
  if (!viewer || !isEngineer(viewer.user)) return 'client';
  const stored = storeGet(VIEW_KEY);
  if (stored === 'client' || stored === 'engineer') return stored;
  if (viewer.user.engineerProfile === 'needed') return 'engineer';
  return viewer.account ? 'client' : 'engineer';
}

function normalizePath(pathname) {
  if (!pathname) return '/';
  return pathname.endsWith('/') ? pathname : pathname + '/';
}

function matchRoute(pathname) {
  const path = normalizePath(pathname);
  for (let i = 0; i < ROUTES.length; i++) {
    if (path === ROUTES[i][0]) return ROUTES[i];
  }
  return null;
}

function destinationFor(route) {
  if (!route || !viewer) return route;
  const office = !!ENGINEER_PAGES[route[1]];
  const engineer = isEngineer(viewer.user) && viewMode() === 'engineer';
  if (isEngineer(viewer.user) && engineer && !office) return matchRoute('/portal/admin/');
  if (isEngineer(viewer.user) && !engineer && office) return matchRoute('/portal/');
  if (!isEngineer(viewer.user) && office) return matchRoute('/portal/');
  return route;
}

function navCurrent(id) {
  if (id === 'settings') return !!SETTINGS_PAGES[page];
  if (id === 'dashboard' || id === 'agents') return page === 'dashboard' || page === 'agents';
  if (id === 'admin') return page === 'admin' || page === 'admin-account';
  return id === page;
}

function railLink(item) {
  const current = navCurrent(item[0]);
  return '<a href="' + item[1] + '" data-page="' + item[0] + '"' + (current ? ' aria-current="page"' : '') + '>' + item[2] + '</a>';
}

function rail(user) {
  if (isEngineer(user) && viewMode() === 'engineer') {
    return [
      ['admin', '/portal/admin/', 'Accounts'],
      ['admin-availability', '/portal/admin/availability/', 'Availability'],
    ].map(railLink).join('');
  }
  return PRIMARY.map(railLink).join('');
}

function markCurrent() {
  document.querySelectorAll('#portal-nav a[data-page], #portal-top-meta a[data-page]').forEach(function (link) {
    if (navCurrent(link.getAttribute('data-page'))) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function viewSwitchHtml() {
  if (!viewer || !isEngineer(viewer.user)) return '';
  const mode = viewMode();
  return '<span class="view-switch" role="group" aria-label="Which portal">' +
    '<button type="button" data-view="engineer"' + (mode === 'engineer' ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>Engineer</button>' +
    '<button type="button" data-view="client"' + (mode === 'client' ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>Client</button>' +
    '</span>';
}

function bindChrome(scope) {
  const sign = scope.querySelector('#sign-out');
  if (sign) sign.addEventListener('click', signOut);
  scope.querySelectorAll('[data-view]').forEach(function (button) {
    button.addEventListener('click', function () {
      const mode = button.getAttribute('data-view');
      if (mode !== 'engineer' && mode !== 'client') return;
      if (viewMode() === mode) return;
      storeSet(VIEW_KEY, mode);
      chromeKey = '';
      setPreviewAccount('');
      void go(mode === 'engineer' ? '/portal/admin/' : '/portal/');
    });
  });
}

async function resetAuthenticator(button) {
  const email = button.getAttribute('data-reset-mfa');
  if (!email) return;
  if (!window.confirm('Reset the authenticator for ' + email + '? They set up a new one the next time they sign in. Assistant connections for that address stop until they allow them again.')) return;
  button.disabled = true;
  try {
    await api('admin/mfa/reset', { method: 'POST', body: { email: email } });
    if (viewer && viewer.user && viewer.user.email === email) {
      storeMfa('');
      location.href = '/portal/';
      return;
    }
    button.textContent = 'Cleared';
  } catch (e) {
    button.disabled = false;
    button.textContent = e.message;
  }
}

async function signOut() {
  const button = document.getElementById('sign-out');
  if (button) button.disabled = true;
  storeMfa('');
  try {
    const auth = await getAuth();
    if (auth) await authApi().signOut(auth);
  } catch (e) { /* leave the page either way */ }
  location.href = '/portal/login/';
}

function previewBar(me) {
  if (!me || !me.user || !isEngineer(me.user) || viewMode() !== 'client') return '';
  const choices = me.previewChoices || [];
  if (!choices.length) return '';
  const current = me.account && me.account.id;
  const options = choices.map(function (account) {
    return '<option value="' + esc(account.id) + '"' + (account.id === current ? ' selected' : '') + '>' + esc(account.office) + '</option>';
  }).join('');
  let note = 'This account is yours. Changes here are live.';
  if (me.account && me.account.sample) note = 'Sample office. Try every page. Changes stay in this browser.';
  else if (me.account && me.account.preview) note = 'Read only. This is what that client sees.';
  const reset = me.account && me.account.sample ? ' <button type="button" id="reset-sample">Reset sample</button>' : '';
  return '<div class="preview-bar"><label>Office <select id="preview-account">' + options + '</select></label><p>' + note + reset + '</p></div>';
}

function paintChrome(user) {
  const nav = document.getElementById('portal-nav');
  if (!nav) return;
  const mode = viewer && isEngineer(viewer.user) ? viewMode() : 'client';
  const key = (user && user.email ? user.email : '') + '|' + mode;
  if (chromeKey === key) {
    markCurrent();
    return;
  }
  chromeKey = key;
  const meta = document.getElementById('portal-top-meta');
  if (meta) {
    const who = isEngineer(user)
      ? personName(user)
      : ((viewer && viewer.account && viewer.account.office) || personName(user));
    const settingsLink = (!isEngineer(user) || viewMode() === 'client')
      ? '<a class="top-settings" href="/portal/settings/" data-page="settings"' + (SETTINGS_PAGES[page] ? ' aria-current="page"' : '') + '>Settings</a>'
      : '';
    meta.innerHTML = (who ? '<span class="portal-who">' + esc(who) + '</span>' : '') +
      viewSwitchHtml() +
      settingsLink +
      '<button type="button" class="top-signout" id="sign-out">Sign out</button>';
    bindChrome(meta);
  }
  nav.hidden = false;
  nav.innerHTML = rail(user);
  revealRail(nav);
}

function shell(me, title, sub) {
  const user = me && me.user ? me.user : me;
  const nav = document.getElementById('portal-nav');
  if (nav) paintChrome(user);
  const crumb = SETTINGS_PAGES[page] && page !== 'settings'
    ? '<p class="settings-back"><a href="/portal/settings/">Settings</a></p>'
    : '';
  const head =
    (me && me.user ? previewBar(me) : '') +
    engineerTaskNotice(me) +
    crumb +
    '<header class="page-head"><h1>' + esc(title) + '</h1>' +
    (sub ? '<p>' + esc(sub) + '</p>' : '') +
    '</header><div id="portal-main"><p class="portal-loading">Loading.</p></div>';
  if (nav) {
    root.innerHTML = head;
  } else {
    root.innerHTML =
      '<div class="portal-frame"><nav class="rail" aria-label="Portal">' + rail(user) + '</nav>' +
      '<div class="portal-body">' + head + '</div></div>';
    revealRail(root.querySelector('.rail'));
  }
  const select = document.getElementById('preview-account');
  if (select) {
    select.addEventListener('change', function () {
      storeSet(PREVIEW_KEY, select.value);
      void refresh();
    });
  }
  const reset = document.getElementById('reset-sample');
  if (reset) {
    reset.addEventListener('click', function () {
      resetSample();
      void refresh();
    });
  }
  const opened = document.getElementById('profile-opened');
  if (opened) {
    opened.addEventListener('click', async function () {
      opened.disabled = true;
      try {
        await api('admin/engineers/profile', { method: 'POST', body: {} });
        if (viewer && viewer.user) {
          viewer.user.engineerProfile = 'opened';
          viewer.user.engineerTask = null;
        }
        await refresh();
      } catch (e) {
        opened.disabled = false;
        const err = document.getElementById('profile-error');
        if (err) {
          err.hidden = false;
          err.textContent = e.message;
        }
      }
    });
  }
  return document.getElementById('portal-main');
}

function engineerTaskNotice(me) {
  const user = me && me.user;
  const task = user && user.engineerTask;
  if (!task || viewMode() !== 'engineer') return '';
  return '<section class="notice" id="engineer-task">' +
    '<p><b>Add your photo and details.</b> Roger Hunt is already on the Studio page. Add yours the same way, in a pull request.</p>' +
    '<ol class="engineer-steps">' +
    '<li>Fork <a href="' + esc(task.repo) + '">the repository</a>.</li>' +
    '<li>Add a square photo at <code>' + esc(task.photo) + '</code>.</li>' +
    '<li>In <code>studio/index.html</code>, find “The engineer.” Copy Roger’s person block and put yours after it. Change the photo path, your name, two sentences about the work you do, and your LinkedIn link. <a href="' + esc(task.page) + '">His block is here.</a></li>' +
    '<li>Open a pull request to main. Leave out client names, keys, and documents.</li>' +
    '</ol>' +
    '<div class="portal-actions"><button type="button" class="btn" id="profile-opened">I’ve opened the pull request</button></div>' +
    '<p class="desk-status" id="profile-error" hidden></p></section>';
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
    '<p class="portal-login-lead">An account is created after a call. Use the email the invite went to. After the link, the portal asks for a code from an authenticator app.</p>' +
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
    const back = sessionStorage.getItem('studioOauthReturn') || '';
    sessionStorage.removeItem('studioOauthReturn');
    location.replace(back.indexOf('/oauth/authorize?') === 0 ? back : '/portal/');
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
  if (me && isEngineer(me.user)) {
    main.innerHTML =
      '<p class="portal-empty">This sign-in is the engineer. Choose Client, then Harbor &amp; Finch, to walk through the sample office.</p>';
    return;
  }
  main.innerHTML =
    '<p class="portal-empty">No account for this address yet. Book a call, and we will invite you after it.</p>' +
    '<div class="portal-actions"><a class="btn" href="/book/">Book a 20-minute call</a></div>';
}

function byNewest(rows, key) {
  return (rows || []).slice().sort(function (a, b) {
    return String(b[key] || '').localeCompare(String(a[key] || ''));
  });
}

function zoneName(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      timeZoneName: 'long',
    }).formatToParts(new Date());
    const hit = parts.find(function (part) { return part.type === 'timeZoneName'; });
    return hit ? hit.value : (timeZone || '');
  } catch (e) {
    return timeZone || '';
  }
}

function lastForAgent(rows, agentId) {
  const mine = byNewest(rows, 'ts').filter(function (row) { return row.agentId === agentId; });
  return mine[0] || null;
}

function agentName(agents, id) {
  const found = (agents || []).find(function (agent) { return agent.id === id; });
  return found ? found.name : '';
}

function agentCard(agent, rows) {
  const last = lastForAgent(rows, agent.id);
  const pause = agent.pauseNote || (agent.status === 'paused' ? 'Paused. It does not post until it is running again.' : '');
  const lastLine = last
    ? 'Last report ' + whenLabel(last.ts) + '. ' + last.summary
    : 'No report yet.';
  return '<article class="record piece">' +
    '<header class="piece-head"><h2>' + esc(agent.name) + '</h2><span class="status ' + statusClass(agent.status) + '">' + esc(label(agent.status)) + '</span></header>' +
    '<p>' + esc(agent.chore) + '</p>' +
    (pause ? '<p class="ledger-detail">' + esc(pause) + '</p>' : '') +
    '<p class="ledger-detail">' + esc(lastLine) + '</p></article>';
}

function reportCard(row, agents) {
  const name = agentName(agents, row.agentId);
  const meta = [whenLabel(row.ts), name || 'Your engineer'].filter(Boolean).join(' · ');
  const flag = row.type && row.type !== 'did'
    ? '<span class="status ' + statusClass(row.type) + '">' + esc(label(row.type)) + '</span>'
    : '';
  return '<article class="record piece">' +
    '<header class="piece-head"><p class="piece-meta">' + esc(meta) + '</p>' + flag + '</header>' +
    '<p>' + esc(row.summary) + '</p>' +
    (row.detail ? '<p class="ledger-detail">' + esc(row.detail) + '</p>' : '') +
    '</article>';
}

function approvalNotice(count) {
  if (!count) return '';
  if (count === 1) {
    return '<p class="notice">One draft is waiting for your approval. <a href="/portal/approvals/">Review it</a>.</p>';
  }
  return '<p class="notice">' + count + ' drafts are waiting for your approval. <a href="/portal/approvals/">Review them</a>.</p>';
}

function meetingUpcoming(meeting) {
  return meeting.status === 'booked' && new Date(meeting.start).getTime() > Date.now();
}

function meetingLabel(meeting) {
  if (meeting.status === 'booked' && !meetingUpcoming(meeting)) return { cls: '', name: 'Held' };
  return { cls: statusClass(meeting.status), name: label(meeting.status) };
}

async function renderAgentsHome(me) {
  const main = shell(me, 'Agents', 'What is set up for your office, and the reports your engineer posts after each run.');
  if (!me.account) return noAccount(main, me);
  const [log, pending] = await Promise.all([api('activity'), api('approvals')]);
  const agents = log.agents || [];
  const rows = byNewest(log.activity || [], 'ts');
  const cards = agents.map(function (agent) { return agentCard(agent, rows); }).join('');
  const shown = rows.slice(0, 6);
  const reports = shown.map(function (row) { return reportCard(row, agents); }).join('');
  const more = rows.length > shown.length
    ? '<p class="portal-more"><a href="/portal/activity/">Older reports</a></p>'
    : '';
  main.innerHTML =
    approvalNotice((pending.approvals || []).length) +
    (cards || empty('No agents yet. They show up here once your engineer sets them up.')) +
    '<h2>Reports</h2>' +
    '<p class="role-note">Your engineer posts a report from Claude or Cursor after a run.</p>' +
    (reports || empty('No reports yet.')) +
    more;
}

async function renderActivity(me) {
  const main = shell(me, 'Activity', 'Newest first. What the agents did, and who signed off.');
  if (!me.account) return noAccount(main, me);
  async function load() {
    const type = document.getElementById('filter-type').value;
    const agent = document.getElementById('filter-agent').value;
    const q = new URLSearchParams();
    if (type) q.set('type', type);
    if (agent) q.set('agent', agent);
    try {
      const data = await api('activity' + (q.toString() ? '?' + q.toString() : ''));
      const rows = byNewest(data.activity, 'ts').map(function (row) {
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
  const initial = new URLSearchParams(location.search);
  main.innerHTML =
    '<div class="portal-filters"><label>Type <select id="filter-type"><option value="">All</option>' +
    '<option value="did">Done</option><option value="needs_approval">Waiting on you</option>' +
    '<option value="blocked">Blocked</option><option value="error">Error</option><option value="note">Note</option></select></label>' +
    '<label>Agent <select id="filter-agent"><option value="">All</option>' + options + '</select></label></div>' +
    '<div id="activity-list"></div>';
  const typeSelect = document.getElementById('filter-type');
  const agentSelect = document.getElementById('filter-agent');
  if (initial.get('type')) typeSelect.value = initial.get('type');
  if (initial.get('agent')) agentSelect.value = initial.get('agent');
  typeSelect.addEventListener('change', load);
  agentSelect.addEventListener('change', load);
  await load();
}


async function renderApprovals(me) {
  const main = shell(me, 'Approvals', 'Read the draft, then approve it or decline it. The decision stays on this page.');
  if (!me.account) return noAccount(main, me);
  const data = await api('approvals');
  const items = byNewest(data.approvals, 'createdAt');
  main.innerHTML = items.length
    ? '<div id="approvals"></div><p class="desk-status" id="approval-error" hidden></p>'
    : empty('Nothing is waiting on you.');
  const list = document.getElementById('approvals');
  if (!list) return;
  items.forEach(function (item) {
    const card = document.createElement('article');
    card.className = 'record piece';
    const subject = item.subject || item.summary || 'Draft';
    const why = item.why || 'A person signs off before a new kind of message goes out.';
    const draft = item.draft || item.summary || '';
    card.innerHTML =
      '<header class="piece-head"><h2>' + esc(subject) + '</h2><span class="status waiting">Waiting</span></header>' +
      '<p class="ledger-detail">' + esc(whenLabel(item.createdAt)) + '</p>' +
      '<p>' + esc(why) + '</p>' +
      (draft ? '<blockquote class="piece-draft">' + esc(draft) + '</blockquote>' : '') +
      '<div class="portal-actions"></div>';
    const actions = card.querySelector('.portal-actions');
    const status = card.querySelector('.status');
    ['approved', 'declined'].forEach(function (decision) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = decision === 'approved' ? 'btn' : 'btn-quiet';
      btn.textContent = decision === 'approved' ? 'Approve' : 'Decline';
      btn.addEventListener('click', async function () {
        actions.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
        try {
          await api('approvals', { method: 'POST', body: { id: item.id, decision: decision } });
          status.className = 'status';
          status.textContent = decision === 'approved' ? 'Approved' : 'Declined';
          const note = document.createElement('p');
          note.className = 'saved';
          note.textContent = decision === 'approved'
            ? 'Approved. It is in the activity log. It will not send until that kind of message is allowed.'
            : 'Declined. It will not be sent.';
          actions.replaceWith(note);
        } catch (e) {
          actions.querySelectorAll('button').forEach(function (button) { button.disabled = false; });
          const err = document.getElementById('approval-error');
          err.hidden = false;
          err.textContent = e.message;
        }
      });
      actions.appendChild(btn);
    });
    list.appendChild(card);
  });
}

async function renderRequests(me) {
  const main = shell(me, 'Requests', 'The studio reads a request on weekdays and answers within one business day.');
  if (!me.account) return noAccount(main, me);
  const data = await api('requests');
  const rows = byNewest(data.requests, 'createdAt').map(function (r) {
    const detail = r.status === 'open'
      ? esc(r.summary) + '<p class="ledger-detail">Open. The studio picks this up on the next weekday.</p>'
      : esc(r.summary);
    return ledgerRow(whenLabel(r.createdAt), statusClass(r.status), label(r.status), detail);
  }).join('');
  main.innerHTML =
    '<form id="request-form" class="desk-fields"><label class="desk-field desk-field-wide"><span>The change</span><input name="summary" required maxlength="500" placeholder="Ask Chase to follow Hale on Tuesdays only."></label>' +
    '<div class="desk-field-wide portal-actions"><button class="btn" type="submit">Send</button></div>' +
    '<p class="desk-status desk-field-wide" id="request-error" hidden></p></form>' +
    '<h2>Sent</h2>' + (rows ? ledger(rows) : empty('Nothing sent yet.'));
  document.getElementById('request-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const err = document.getElementById('request-error');
    err.hidden = true;
    try {
      await api('requests', { method: 'POST', body: { summary: new FormData(event.target).get('summary') } });
      await refresh();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
}

function slotButtons(slots, timeZone, onPick) {
  const box = document.createElement('div');
  box.className = 'book-times';
  (slots || []).slice(0, 8).forEach(function (slot) {
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

function callKind(type) {
  if (type === 'checkpoint') return 'Check-in';
  if (type === 'monthly') return 'Monthly call';
  return label(type);
}

function nextCallType(meetings) {
  if ((meetings || []).some(meetingUpcoming)) return '';
  const hadCheckpoint = (meetings || []).some(function (meeting) {
    return meeting.type === 'checkpoint' && meeting.status !== 'cancelled' && meeting.status !== 'canceled';
  });
  return hadCheckpoint ? 'monthly' : 'checkpoint';
}

function appointmentCard(meeting, allowCancel) {
  const state = meetingLabel(meeting);
  const when = meeting.when || whenLabel(meeting.start);
  const cancel = allowCancel
    ? '<div class="portal-actions"><button type="button" class="btn-quiet" data-cancel="' + esc(meeting.id) + '">Cancel</button></div>'
    : '';
  return '<article class="record piece">' +
    '<header class="piece-head"><h2>' + esc(when) + '</h2><span class="status ' + state.cls + '">' + esc(state.name) + '</span></header>' +
    '<p>' + esc(callKind(meeting.type)) + ' with your engineer.</p>' +
    cancel + '</article>';
}

async function renderMeetings(me) {
  const main = shell(me, 'Book a call', 'A time with your AI engineer.');
  if (!me.account) return noAccount(main, me);
  const data = await api('meetings');
  const meetings = data.meetings || [];
  const upcoming = meetings.filter(meetingUpcoming).sort(function (a, b) {
    return String(a.start).localeCompare(String(b.start));
  });
  const past = byNewest(meetings.filter(function (meeting) { return !meetingUpcoming(meeting); }), 'start').slice(0, 3);
  const closed = me.account.status === 'cancelled';
  if (closed && !upcoming.length) {
    main.innerHTML = empty('This account is closed, so new calls are not open.');
    return;
  }
  const type = closed ? '' : nextCallType(meetings);
  const intro = type === 'checkpoint'
    ? 'Pick a time for the check-in. It is the call about a month into the work.'
    : (type === 'monthly' ? 'Pick a time for the monthly call.' : '');
  main.innerHTML =
    (upcoming.length
      ? upcoming.map(function (meeting) { return appointmentCard(meeting, true); }).join('')
      : '<p class="portal-empty">No call booked.</p>') +
    (type
      ? '<h2>Pick a time</h2><p class="role-note">' + esc(intro) + '</p><div id="slot-box"><p class="portal-loading">Loading times.</p></div>'
      : (upcoming.length ? '<p class="role-note">Another time opens after this call.</p>' : '')) +
    '<p class="desk-status" id="meet-error" hidden></p>' +
    (past.length
      ? '<h2>Earlier</h2>' + past.map(function (meeting) { return appointmentCard(meeting, false); }).join('')
      : '');
  main.querySelectorAll('[data-cancel]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        await api('meetings/cancel', { method: 'POST', body: { id: btn.getAttribute('data-cancel') } });
        await refresh();
      } catch (e) {
        btn.disabled = false;
        const err = document.getElementById('meet-error') || document.createElement('p');
        err.hidden = false;
        err.textContent = e.message;
      }
    });
  });
  if (!type) return;
  const err = document.getElementById('meet-error');
  const box = document.getElementById('slot-box');
  try {
    const slots = await api('meetings/slots?type=' + type);
    box.textContent = '';
    if (slots.closed) {
      box.innerHTML = empty(slots.closed);
      return;
    }
    if (!(slots.slots || []).length) {
      box.innerHTML = empty('No open times in the next two weeks.');
      return;
    }
    const zone = document.createElement('p');
    zone.className = 'role-note';
    zone.textContent = 'Times are in ' + zoneName(slots.timeZone) + '.';
    box.appendChild(zone);
    box.appendChild(slotButtons(slots.slots, slots.timeZone, async function (slot, button) {
      button.disabled = true;
      try {
        const held = await api('meetings/hold', { method: 'POST', body: { type: type, start: slot.start } });
        await api('meetings', { method: 'POST', body: { type: type, start: slot.start, holdToken: held.holdToken } });
        await refresh();
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

function planPrice(status) {
  if (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'unpaid') return '$1,000 a month';
  return '$6,000 to start, then $1,000 a month';
}

async function renderBilling(me) {
  const main = shell(me, 'Subscription', 'Pay, change the card, or open an invoice.');
  if (!me.account) return noAccount(main, me);
  const queryStatus = new URLSearchParams(location.search).get('status');
  const banner = queryStatus === 'success'
    ? '<p class="notice">Payment received. The account updates when Stripe confirms it.</p>'
    : (queryStatus === 'cancel' ? '<p class="notice">The payment was not completed.</p>' : '');
  const status = me.account.billingStatus || 'none';
  const active = status === 'active' || status === 'trialing';
  const problem = status === 'past_due' || status === 'unpaid';
  const invoices = me.account.invoices || [];
  const invoiceRows = invoices.map(function (invoice) {
    return ledgerRow(whenLabel(invoice.when), '', invoice.status || '', esc(invoice.label) + '. ' + esc(invoice.amount) + '.');
  }).join('');
  const actions = active
    ? '<button class="btn" id="manage-bill" type="button">Manage subscription</button>'
    : (problem
      ? '<button class="btn" id="manage-bill" type="button">Update payment</button>'
      : '<button class="btn" id="pay" type="button">Pay $6,000</button><button class="btn-quiet" id="manage-bill" type="button">Invoices and card</button>');
  const note = active
    ? 'The monthly charge keeps the agents running. It includes weekday replies, the monthly call, and the written report.'
    : (problem
      ? 'Update the card to keep the agents running.'
      : '$5,000 sets the agents up. $1,000 is the first month. Every month after that is $1,000.');
  main.innerHTML = banner +
    '<dl class="plan"><div><dt>Status</dt><dd>' + esc(label(status)) + '</dd></div>' +
    '<div><dt>Price</dt><dd>' + esc(planPrice(status)) + '</dd></div></dl>' +
    '<p class="bill-note">' + esc(note) + '</p>' +
    '<div class="portal-actions">' + actions + '</div>' +
    '<h2>Invoices</h2>' + (invoiceRows ? ledger(invoiceRows) : empty(active ? 'No invoice is on file yet.' : 'No invoice yet. The first one is created when you pay.')) +
    '<p class="desk-status" id="bill-error" hidden></p>';
  async function go(path, button) {
    const err = document.getElementById('bill-error');
    err.hidden = true;
    button.disabled = true;
    try {
      const data = await api(path, { method: 'POST', body: {} });
      if (data.notice) {
        button.disabled = false;
        err.hidden = false;
        err.textContent = data.notice;
        return;
      }
      if (data.sample) {
        await refresh();
        return;
      }
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
  const peopleLine = me.account
    ? me.account.office + (me.account.kind ? ', ' + me.account.kind : '') + '. Who can open this account, and who gets the weekly note.'
    : 'Who can open this account, and who gets the weekly note.';
  const main = shell(me, 'People', peopleLine);
  if (!me.account) return noAccount(main, me);
  const owner = me.account.role === 'owner';
  const meMember = (me.account.members || []).find(function (m) { return m.email === me.user.email; });
  const receivers = (me.account.members || []).filter(function (m) { return m.digest !== false; }).map(function (m) { return m.name || m.email; });
  const rows = (me.account.members || []).map(function (m) {
    const remove = owner && m.role !== 'owner'
      ? '<div class="portal-actions"><button type="button" class="btn-quiet" data-remove="' + esc(m.email) + '">Remove</button></div>'
      : '';
    const roleNote = m.role === 'owner'
      ? 'Can invite people, pay the invoice, and remove members.'
      : 'Can read the portal and send requests.';
    const mail = m.digest === false ? 'Does not get the weekly note.' : 'Gets the weekly note and the monthly report.';
    return ledgerRow(m.name || m.email, '', label(m.role), esc(m.email) + '<p class="ledger-detail">' + esc(roleNote) + ' ' + esc(mail) + '</p>' + remove);
  }).join('');
  main.innerHTML =
    '<p class="role-note">An owner runs the account. A member can read it and send requests. The weekly note and the monthly report go to ' +
    (receivers.length ? esc(receivers.join(', ')) : 'no one yet') + '.</p>' +
    (rows ? ledger(rows) : empty('No one is on this account yet.')) +
    (meMember
      ? '<label class="portal-check"><input type="checkbox" id="digest"' + (meMember.digest !== false ? ' checked' : '') + '> Email me the weekly note and the monthly report</label>'
      : '') +
    (owner
      ? '<h2>Invite someone at the firm</h2><p class="role-note">They get a link to this portal. They do not get billing access unless they are an owner.</p><form id="invite" class="desk-fields"><label class="desk-field"><span>Name</span><input name="name"></label><label class="desk-field"><span>Email</span><input type="email" name="email" required></label><div class="desk-field-wide portal-actions"><button class="btn" type="submit">Send invite</button></div><p class="desk-status desk-field-wide" id="invite-error" hidden></p></form>'
      : '') +
    '<p class="desk-status" id="account-error" hidden></p>';
  const digest = document.getElementById('digest');
  if (digest) digest.addEventListener('change', function (event) {
    api('members/digest', { method: 'POST', body: { digest: event.target.checked } });
  });
  main.querySelectorAll('[data-remove]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        await api('members/remove', { method: 'POST', body: { email: btn.getAttribute('data-remove') } });
        await refresh();
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
      await refresh();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
}

function connectionPanel(lead) {
  const url = location.origin + '/api/studio-mcp';
  return '<section class="portal-section"><h2>Connect an assistant</h2>' +
    '<p class="role-note">' + esc(lead) + '</p>' +
    '<p class="key-once">' + esc(url) + '</p>' +
    '<p class="role-note">Paste that URL into Claude, Cursor, or Grok. It will ask you to sign in. There is no key to copy.</p></section>';
}

async function renderSettings(me) {
  const main = shell(me, 'Settings', 'The rest of the account.');
  if (!me.account) return noAccount(main, me);
  const items = [
    ['/portal/activity/', 'Activity', 'The full list of reports, with filters.'],
    ['/portal/approvals/', 'Approvals', 'Drafts waiting for you to approve or decline.'],
    ['/portal/requests/', 'Requests', 'Ask for a change. The studio answers on weekdays.'],
    ['/portal/reports/', 'Monthly report', 'The written summary of the month.'],
    ['/portal/account/', 'People', 'Who can open this account, and who gets the weekly note.'],
  ];
  main.innerHTML = connectionPanel('Claude, Cursor, Grok, or any other assistant that signs in. Allow it for this office. It can see this office and do what you can do here. It cannot pay, and it cannot open another office.') +
    '<nav class="settings-list" aria-label="Settings">' + items.map(function (item) {
    return '<a href="' + item[0] + '"><span>' + item[1] + '</span><small>' + item[2] + '</small></a>';
  }).join('') + '</nav>';
}

async function renderReports(me) {
  const main = shell(me, 'Monthly report', 'Written from the reports your engineer posted.');
  if (!me.account) return noAccount(main, me);
  const month = new URLSearchParams(location.search).get('month') || '';
  const data = await api('reports');
  const reports = data.reports || [];
  const current = reports.find(function (r) { return r.month === month; }) || reports[0];
  if (!reports.length) {
    main.innerHTML = empty('No report yet. The first one is written at the start of the next month.');
    return;
  }
  const counts = current && current.counts;
  const figures = counts
    ? '<ul class="figures">' +
      '<li><span class="fig">' + esc(current.total || 0) + '</span><p>Updates. <a href="/portal/activity/">Activity</a></p></li>' +
      '<li><span class="fig">' + esc(counts.did || 0) + '</span><p>Done.</p></li>' +
      '<li><span class="fig">' + esc(counts.waiting || 0) + '</span><p>Waiting on you.</p></li>' +
      '<li><span class="fig">' + esc((counts.blocked || 0) + (counts.note || 0)) + '</span><p>Blocked or noted.</p></li>' +
      '</ul>'
    : '<p class="role-note">' + esc(current && current.total || 0) + ' updates. <a href="/portal/activity/">Activity</a></p>';
  main.innerHTML =
    '<div class="book-days">' + reports.map(function (r) {
      const on = current && r.month === current.month;
      return '<a class="book-slot' + (on ? ' is-on' : '') + '" href="/portal/reports/?month=' + esc(r.month) + '"' +
        (on ? ' aria-current="page"' : '') + '>' + esc(monthLabel(r.month)) + (r.soFar ? ' so far' : '') + '</a>';
    }).join('') + '</div>' +
    (current
      ? '<h2>' + esc(monthLabel(current.month)) + (current.soFar ? ', so far' : '') + '</h2>' + figures +
        ((current.highlights || []).length
          ? '<ul class="posture">' + current.highlights.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>'
          : '')
      : empty('No report yet. The first one is written at the start of the next month.'));
}

async function renderAdmin(me) {
  const main = shell(me, 'Accounts', 'Create an account after a call. Leads from the form and the calendar land here.');
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
  const engineers = (data.engineers || []).map(function (row) {
    const state = row.status !== 'claimed' ? 'Invited' : (row.profile === 'opened' ? 'Pull request opened' : 'Joined');
    return ledgerRow(
      row.name || row.email,
      '',
      state,
      esc(row.email) + ' <button type="button" class="btn-quiet" data-reset-mfa="' + esc(row.email) + '">Reset authenticator</button>',
    );
  }).join('');
  main.innerHTML =
    '<p class="notice">Harbor &amp; Finch is a sample office, with agents, approvals, meetings, and a report. <button type="button" id="open-sample">Open it as the client</button></p>' +
    '<h2>Invite an engineer</h2>' +
    '<p class="role-note">They can open every account. The invite tells them to add a photo and a short bio in a pull request, the way Roger is already on the Studio page.</p>' +
    '<form id="invite-engineer" class="desk-fields">' +
    '<label class="desk-field"><span>Name</span><input name="name" required></label>' +
    '<label class="desk-field"><span>Email</span><input type="email" name="email" required></label>' +
    '<div class="desk-field-wide portal-actions"><button class="btn" type="submit">Send invite</button></div>' +
    '<p class="desk-status desk-field-wide" id="engineer-error" hidden></p></form>' +
    (engineers ? ledger(engineers, ['Name', 'Status', 'Email']) : empty('No engineers invited yet.')) +
    connectionPanel('Connect Claude, Cursor, or Grok to this engineer account. When it asks you to sign in, allow it as an engineer. It can open the offices, set up agents, and post reports. It cannot pay, and it cannot invite another engineer.') +
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
  document.getElementById('open-sample').addEventListener('click', function () {
    storeSet(VIEW_KEY, 'client');
    storeSet(PREVIEW_KEY, SAMPLE_ID);
    chromeKey = '';
    void go('/portal/');
  });
  main.querySelectorAll('[data-reset-mfa]').forEach(function (button) {
    button.addEventListener('click', function () { void resetAuthenticator(button); });
  });
  document.getElementById('invite-engineer').addEventListener('submit', async function (event) {
    event.preventDefault();
    const err = document.getElementById('engineer-error');
    err.hidden = true;
    const fd = new FormData(event.target);
    try {
      await api('admin/engineers', {
        method: 'POST',
        body: { name: fd.get('name'), email: fd.get('email') },
      });
      event.target.reset();
      await refresh();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
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
      await go('/portal/admin/account/?id=' + encodeURIComponent(created.account.id));
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  });
}

async function renderAdminAccount(me) {
  const id = new URLSearchParams(location.search).get('id') || '';
  const main = shell(me, 'Account', '');
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
      esc(a.chore) + '<div class="portal-actions"><button type="button" class="btn-quiet" data-status="' + esc(a.id) + '" data-next="' + next + '">' + verb + '</button>' +
      (a.keyWaiting ? '<button type="button" class="btn-quiet" data-show-key="' + esc(a.id) + '">Show the key once</button>' : '') +
      '</div>',
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
  const people = (acc.members || []).filter(function (m) { return m && m.email; });
  const resets = people.map(function (m) {
    return '<div class="portal-actions"><button type="button" class="btn-quiet" data-reset-mfa="' + esc(m.email) + '">Reset authenticator for ' + esc(m.email) + '</button></div>';
  }).join('');
  main.innerHTML =
    '<form id="reply" class="desk-fields"><label class="desk-field desk-field-wide"><span>Reply time shown on the account</span><input name="replyTime" value="' + esc(acc.replyTime || '') + '" placeholder="Weekdays, within one business day"></label>' +
    '<div class="desk-field-wide portal-actions"><button class="btn" type="submit">Save</button><p class="saved" id="reply-ok" hidden>Saved.</p></div></form>' +
    (resets ? '<section class="portal-section"><h2>Authenticator</h2><p class="role-note">If someone loses the authenticator and the backup codes, clear it. They set up a new one the next time they sign in.</p>' + resets + '</section>' : '') +
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
  main.querySelectorAll('[data-reset-mfa]').forEach(function (button) {
    button.addEventListener('click', function () { void resetAuthenticator(button); });
  });
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
  main.querySelectorAll('[data-show-key]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        const shown = await api('admin/agents/key', {
          method: 'POST',
          body: { accountId: id, agentId: btn.getAttribute('data-show-key') },
        });
        const key = document.getElementById('new-key');
        key.hidden = false;
        key.textContent = 'Copy this key now. It is not shown again. ' + shown.apiKey;
        btn.hidden = true;
      } catch (e) { show(e); }
    });
  });
  main.querySelectorAll('[data-status]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await api('admin/agents/status', { method: 'POST', body: { accountId: id, agentId: btn.getAttribute('data-status'), status: btn.getAttribute('data-next') } });
        await refresh();
      } catch (e) { show(e); }
    });
  });
  document.getElementById('note').addEventListener('submit', async function (event) {
    event.preventDefault();
    err.hidden = true;
    try {
      await api('admin/notes', { method: 'POST', body: { accountId: id, summary: new FormData(event.target).get('summary') } });
      await refresh();
    } catch (e) { show(e); }
  });
  main.querySelectorAll('[data-approve]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await api('admin/approvals', { method: 'POST', body: { accountId: id, id: btn.getAttribute('data-approve'), decision: 'approved' } });
        await refresh();
      } catch (e) { show(e); }
    });
  });
  main.querySelectorAll('[data-done]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await api('admin/requests', { method: 'POST', body: { accountId: id, id: btn.getAttribute('data-done') } });
        await refresh();
      } catch (e) { show(e); }
    });
  });
  document.getElementById('gen-report').addEventListener('click', async function () {
    try {
      await api('admin/reports', { method: 'POST', body: { accountId: id } });
      storeSet(VIEW_KEY, 'client');
      storeSet(PREVIEW_KEY, id);
      chromeKey = '';
      await go('/portal/reports/');
    } catch (e) { show(e); }
  });
}

async function renderAvailability(me) {
  const main = shell(me, 'Availability', 'Leave a day blank to keep it closed. Hours look like 10:00.');
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

function showError(e) {
    if (e && e.mfa && root) {
    storeMfa('');
    setPreviewAccount('');
    void ensureMfa(root, { mfa: e.mfa, user: viewer && viewer.user }).then(function () {
      location.reload();
    });
    return;
  }
  const main = document.getElementById('portal-main');
  const html = '<p class="desk-status">' + esc(e.message || 'Try again.') + '</p>';
  if (main) main.innerHTML = html;
  else if (root) root.innerHTML = '<header class="page-head"><h1>Something went wrong.</h1></header>' + html;
}

async function presented() {
  setPreviewAccount('');
  if (!viewer || !isEngineer(viewer.user) || viewMode() !== 'client') return viewer;
  const choices = [{ id: SAMPLE_ID, office: 'Harbor & Finch (sample)' }];
  try {
    const data = await api('admin/accounts');
    (data.accounts || []).forEach(function (account) {
      choices.push({ id: account.id, office: account.office || 'Account' });
    });
  } catch (e) { /* the sample office still opens */ }
  const ownId = viewer.account && viewer.account.id;
  let id = storeGet(PREVIEW_KEY);
  const known = choices.some(function (account) { return account.id === id; });
  if (!known) id = ownId || SAMPLE_ID;
  storeSet(PREVIEW_KEY, id);
  if (id === SAMPLE_ID) {
    setPreviewAccount(SAMPLE_ID);
    bindSampleUser(viewer.user.email, personName(viewer.user));
    return { user: viewer.user, account: sampleAccount(), previewChoices: choices };
  }
  if (ownId && id === ownId) {
    return { user: viewer.user, account: viewer.account, previewChoices: choices };
  }
  setPreviewAccount(id);
  const overlay = await api('me');
  return { user: overlay.user, account: overlay.account, previewChoices: choices };
}

async function paint(route, opts) {
  const options = opts || {};
  page = route[1];
  if (root) root.dataset.page = page;
  document.title = route[2] + ' · Algorithmacy Studio';
  let me;
  try {
    me = await presented();
  } catch (e) {
    showError(e);
    return;
  }
  try {
    await PAGES[page](me);
  } catch (e) {
    showError(e);
    return;
  }
  if (options.focus) {
    const heading = document.querySelector('#portal .page-head h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
  if (options.scroll !== false) {
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    document.documentElement.style.scrollBehavior = previous;
  }
}

async function goNow(url, opts) {
  const options = opts || {};
  const next = new URL(url, location.origin);
  const route = matchRoute(next.pathname);
  if (!route) {
    location.assign(next.href);
    return;
  }
  const dest = destinationFor(route);
  const search = dest[0] === route[0] ? next.search : '';
  const target = dest[0] + search;
  const here = normalizePath(location.pathname) + location.search;
  if (here !== target) {
    const state = { portal: 1 };
    if (options.replace) history.replaceState(state, '', target);
    else history.pushState(state, '', target);
  }
  await paint(dest, options);
}

async function go(url, opts) {
  if (rendering) {
    queued = { url: String(url), opts: opts || {} };
    return;
  }
  rendering = true;
  try {
    await goNow(url, opts || {});
  } finally {
    rendering = false;
    if (queued) {
      const next = queued;
      queued = null;
      await go(next.url, next.opts);
    }
  }
}

function refresh() {
  return go(location.pathname + location.search, { replace: true, focus: false, scroll: false });
}

function onPortalClick(event) {
  if (!viewer || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
  if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
  const href = anchor.getAttribute('href') || '';
  if (href.charAt(0) === '#') return;
  let url;
  try { url = new URL(anchor.href, location.origin); } catch (e) { return; }
  if (url.origin !== location.origin) return;
  const route = matchRoute(url.pathname);
  if (!route) return;
  const dest = destinationFor(route);
  const search = dest[0] === route[0] ? url.search : '';
  if (dest[0] + search === normalizePath(location.pathname) + location.search) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  void go(url.pathname + url.search);
}

const PAGES = {
  login: renderLogin,
  finish: renderFinish,
  dashboard: renderAgentsHome,
  activity: renderActivity,
  agents: renderAgentsHome,
  settings: renderSettings,
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
    let me = await session();
    if (!me) return;
    if (me.mfa && me.mfa !== 'ok') {
      await ensureMfa(root, me);
      me = await session();
      if (!me || (me.mfa && me.mfa !== 'ok')) return;
    }
    viewer = me;
    bindSampleUser(me.user.email, personName(me.user));
    document.addEventListener('click', onPortalClick);
    window.addEventListener('popstate', function () {
      void go(location.pathname + location.search, { replace: true, focus: false });
    });
    const route = matchRoute(location.pathname) || matchRoute('/portal/');
    const dest = destinationFor(route);
    if (dest[0] !== normalizePath(location.pathname)) {
      history.replaceState({ portal: 1 }, '', dest[0]);
    }
    await paint(dest, { focus: false, scroll: false });
  } catch (e) {
    showError(e);
  }
}

boot();
