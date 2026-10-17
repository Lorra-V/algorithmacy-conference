const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEETING_TYPES = ['discovery', 'checkpoint', 'monthly'];
const EVENT_TYPES = ['did', 'needs_approval', 'blocked', 'error', 'note'];
const OFFICE_KINDS = [
  'law firm',
  'dental practice or med spa',
  'real estate office',
  'CPA firm',
  'owner-run office',
];

function clip(v, max) {
  const s = typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim() : '';
  return s.slice(0, max);
}

function validateBook(b) {
  const errors = [];
  const name = clip(b.name, 120);
  if (name.length < 2) errors.push('Your name is required.');
  const email = clip(b.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) errors.push('A valid email is required.');
  const business = clip(b.business, 160);
  if (business.length < 2) errors.push('The business is required.');
  const type = MEETING_TYPES.includes(b.type) ? b.type : '';
  if (!type) errors.push('Choose a meeting.');
  const when = new Date(b.start);
  if (!b.start || Number.isNaN(when.getTime())) errors.push('Choose a time.');
  const note = clip(b.note || '', 400);
  const holdToken = clip(b.holdToken || '', 80);
  return {
    errors,
    clean: {
      name,
      email,
      business,
      type,
      start: Number.isNaN(when.getTime()) ? '' : when.toISOString(),
      note,
      holdToken,
    },
  };
}

function validateAccountCreate(b) {
  const errors = [];
  const office = clip(b.office, 160);
  if (office.length < 2) errors.push('The business is required.');
  const kind = OFFICE_KINDS.includes(b.kind) ? b.kind : '';
  if (!kind) errors.push('Choose the kind of office.');
  const name = clip(b.name, 120);
  if (name.length < 2) errors.push('A name is required.');
  const email = clip(b.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) errors.push('A valid email is required.');
  return { errors, clean: { office, kind, name, email } };
}

function validateInvite(b) {
  const errors = [];
  const name = clip(b.name, 120);
  const email = clip(b.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) errors.push('A valid email is required.');
  return { errors, clean: { name, email } };
}

function validateEvent(b) {
  const errors = [];
  const type = EVENT_TYPES.includes(b.type) ? b.type : '';
  if (!type) errors.push('Choose a type: did, needs_approval, blocked, error, or note.');
  const summary = clip(b.summary, 500);
  if (summary.length < 2) errors.push('A summary is required.');
  const detail = typeof b.detail === 'string' ? b.detail.replace(/\r/g, '').trim().slice(0, 4000) : '';
  const agentId = clip(b.agentId, 80);
  return { errors, clean: { type, summary, detail, agentId } };
}

function validateSteps(raw) {
  let source;
  if (raw == null || raw === '') source = [];
  else if (Array.isArray(raw)) source = raw;
  else if (typeof raw === 'string') source = raw.split(/\r?\n/);
  else return { errors: ['Write each step on its own line.'], clean: [] };
  const errors = [];
  const steps = [];
  for (const item of source) {
    const step = clip(typeof item === 'string' ? item : '', 160);
    if (!step) continue;
    if (step.length < 2) {
      errors.push('Each step needs at least two characters.');
      continue;
    }
    steps.push(step);
  }
  if (steps.length > 12) errors.push('A flow has at most 12 steps.');
  return { errors, clean: errors.length ? [] : steps };
}

function validateRequest(b) {
  const errors = [];
  const summary = clip(b.summary, 500);
  if (summary.length < 2) errors.push('Say what should change.');
  return { errors, clean: { summary } };
}

function validateAgent(b) {
  const errors = [];
  const name = clip(b.name, 80);
  if (name.length < 2) errors.push('Name the agent.');
  const chore = clip(b.chore, 160);
  if (chore.length < 2) errors.push('Name the chore.');
  const flow = b.steps == null || b.steps === ''
    ? { errors: [], clean: [] }
    : validateSteps(b.steps);
  errors.push(...flow.errors);
  return { errors, clean: { name, chore, steps: errors.length ? [] : flow.clean } };
}

function validateAvailability(b) {
  const errors = [];
  const timeZone = typeof b.timeZone === 'string' ? b.timeZone.trim() : '';
  if (!timeZone) errors.push('A time zone is required.');
  else {
    try { Intl.DateTimeFormat('en-US', { timeZone }); }
    catch { errors.push('The time zone is not recognized.'); }
  }
  const bufferMin = Number(b.bufferMin);
  if (!Number.isInteger(bufferMin) || bufferMin < 0 || bufferMin > 120) {
    errors.push('The buffer must be a whole number of minutes from 0 to 120.');
  }
  const durations = {};
  for (const key of ['discovery', 'checkpoint', 'monthly']) {
    const n = Number(b.durations && b.durations[key]);
    if (!Number.isInteger(n) || n < 10 || n > 180) errors.push('Each meeting length must be 10 to 180 minutes.');
    else durations[key] = n;
  }
  const windows = [];
  const rawWindows = Array.isArray(b.windows) ? b.windows : [];
  for (const w of rawWindows) {
    const dow = Number(w && w.dow);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) { errors.push('A day is invalid.'); break; }
    if (!HM.test((w && w.start) || '') || !HM.test((w && w.end) || '')) {
      errors.push('Hours must look like 10:00.');
      break;
    }
    if (w.start >= w.end) { errors.push('A window ends before it starts.'); break; }
    windows.push({ dow, start: w.start, end: w.end });
  }
  const exceptions = [];
  for (const e of (Array.isArray(b.exceptions) ? b.exceptions : [])) {
    if (!DATE.test((e && e.date) || '')) { errors.push('An exception date is invalid.'); break; }
    if (e.closed) exceptions.push({ date: e.date, closed: true });
    else if (HM.test(e.start || '') && HM.test(e.end || '') && e.start < e.end) {
      exceptions.push({ date: e.date, start: e.start, end: e.end });
    } else {
      errors.push('An exception is invalid.');
      break;
    }
  }
  return {
    errors,
    clean: { timeZone, bufferMin, durations, windows, exceptions, leadMin: 120 },
  };
}

function validateEmail(v) {
  const email = clip(v, 200).toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

function approvalFields(event) {
  const summary = event && event.summary ? String(event.summary) : '';
  const detail = event && event.detail ? String(event.detail) : '';
  return { summary, draft: detail, status: 'pending' };
}

function assertPendingDecision(status) {
  if (status !== 'pending') {
    const err = new Error('That decision is already recorded.');
    err.status = 409;
    throw err;
  }
}

function countEvents(rows) {
  const counts = { did: 0, needs_approval: 0, blocked: 0, error: 0, note: 0 };
  for (const row of rows || []) {
    if (row && Object.prototype.hasOwnProperty.call(counts, row.type)) counts[row.type] += 1;
  }
  return counts;
}

module.exports = {
  EMAIL_RE,
  MEETING_TYPES,
  EVENT_TYPES,
  OFFICE_KINDS,
  clip,
  validateBook,
  validateAccountCreate,
  validateInvite,
  validateEvent,
  validateSteps,
  validateRequest,
  validateAgent,
  validateAvailability,
  validateEmail,
  approvalFields,
  assertPendingDecision,
  countEvents,
};
