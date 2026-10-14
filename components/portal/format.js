export const LABELS = {
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

export function label(value) {
  if (value == null || value === '') return '';
  const key = String(value);
  if (LABELS[key]) return LABELS[key];
  return key.replace(/_/g, ' ');
}

export function statusClass(value) {
  if (value === 'needs_approval' || value === 'pending' || value === 'open') return 'waiting';
  if (value === 'blocked' || value === 'error' || value === 'past_due' || value === 'declined' || value === 'unpaid') return 'blocked';
  return '';
}

export function whenLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export function monthLabel(key) {
  const match = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!match) return key || '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(+match[1], +match[2] - 1, 1)));
}

export function personName(user) {
  const raw = user && typeof user.name === 'string' ? user.name.trim() : '';
  if (!raw || raw.indexOf('@') !== -1) return (user && user.email) || '';
  if (raw !== raw.toLowerCase()) return raw;
  return raw.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function isEngineer(user) {
  return !!(user && user.isAdmin);
}

export function byNewest(rows, key) {
  return (rows || []).slice().sort((a, b) => String(b[key] || '').localeCompare(String(a[key] || '')));
}

export function zoneName(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      timeZoneName: 'long',
    }).formatToParts(new Date());
    const hit = parts.find((part) => part.type === 'timeZoneName');
    return hit ? hit.value : (timeZone || '');
  } catch (e) {
    return timeZone || '';
  }
}

export function meetingUpcoming(meeting) {
  return meeting.status === 'booked' && new Date(meeting.start).getTime() > Date.now();
}

export function meetingLabel(meeting) {
  if (meeting.status === 'booked' && !meetingUpcoming(meeting)) return { cls: '', name: 'Held' };
  return { cls: statusClass(meeting.status), name: label(meeting.status) };
}

export function callKind(type) {
  if (type === 'checkpoint') return 'Check-in';
  if (type === 'monthly') return 'Monthly call';
  return label(type);
}

export function nextCallType(meetings) {
  if ((meetings || []).some(meetingUpcoming)) return '';
  const hadCheckpoint = (meetings || []).some((meeting) => (
    meeting.type === 'checkpoint' && meeting.status !== 'cancelled' && meeting.status !== 'canceled'
  ));
  return hadCheckpoint ? 'monthly' : 'checkpoint';
}

export function planPrice(status) {
  if (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'unpaid') return '$1,000 a month';
  return '$6,000 to start, then $1,000 a month';
}

export function billingNotStarted(account) {
  const status = (account && account.billingStatus) || 'none';
  return status === 'none' || status === 'incomplete' || status === 'incomplete_expired';
}

export function normalizePath(pathname) {
  if (!pathname) return '/';
  return pathname.endsWith('/') ? pathname : pathname + '/';
}

export function safeNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/portal/') || raw.startsWith('//')) return '/portal/';
  return raw;
}

const ROUTES = [
  ['/portal/admin/availability/', 'admin-availability'],
  ['/portal/admin/engineers/', 'admin-engineers'],
  ['/portal/admin/leads/', 'admin-leads'],
  ['/portal/admin/account/', 'admin-account'],
  ['/portal/admin/', 'admin'],
  ['/portal/login/finish/', 'finish'],
  ['/portal/login/', 'login'],
  ['/portal/settings/', 'settings'],
  ['/portal/activity/', 'activity'],
  ['/portal/agents/', 'agents'],
  ['/portal/approvals/', 'approvals'],
  ['/portal/requests/', 'requests'],
  ['/portal/meetings/', 'meetings'],
  ['/portal/reports/', 'reports'],
  ['/portal/billing/', 'billing'],
  ['/portal/account/', 'account'],
  ['/portal/', 'dashboard'],
];

export function pageId(pathname) {
  const path = normalizePath(pathname);
  for (let i = 0; i < ROUTES.length; i++) {
    if (path === ROUTES[i][0]) return ROUTES[i][1];
  }
  return '';
}

export function destinationPath(pathname, user, mode) {
  const path = normalizePath(pathname);
  if (!path.startsWith('/portal/') || path.startsWith('/portal/login')) return '';
  const office = path.startsWith('/portal/admin/');
  const engineer = isEngineer(user);
  if (engineer && mode === 'engineer' && !office) return '/portal/admin/';
  if (!engineer && office) return '/portal/';
  return '';
}
