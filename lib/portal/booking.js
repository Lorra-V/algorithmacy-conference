const crypto = require('node:crypto');
const core = require('../submission-core');
const { db } = require('./firebase-admin');
const store = require('./db');
const { sendMail } = require('./mail');
const { buildIcs } = require('./ics');
const { DEFAULT_AVAILABILITY, generateSlots, formatWhen } = require('./slots');
const { validateBook } = require('./validate');
const { fail, send, siteUrl, escapeHtml, queryValue, readJson, clientIp } = require('./http');

const ROGER = 'roger@algorithmacy.org';
const HOLD_MS = 10 * 60 * 1000;

function availabilityOrDefault(saved) {
  if (!saved || !saved.timeZone || !Array.isArray(saved.windows)) return DEFAULT_AVAILABILITY;
  return {
    timeZone: saved.timeZone,
    bufferMin: saved.bufferMin ?? DEFAULT_AVAILABILITY.bufferMin,
    leadMin: saved.leadMin ?? 120,
    durations: { ...DEFAULT_AVAILABILITY.durations, ...(saved.durations || {}) },
    windows: saved.windows,
    exceptions: saved.exceptions || [],
  };
}

async function loadAvailability() {
  return availabilityOrDefault(await store.getAvailability());
}

function meetUrl() {
  return process.env.STUDIO_MEET_URL || '';
}

async function busyAndHolds(fromMs, toMs, ignoreMeetingId, ignoreHoldToken) {
  const snap = await store.meetings()
    .where('startMs', '>=', fromMs - 12 * 3600000)
    .where('startMs', '<', toMs)
    .get();
  const busy = [];
  snap.forEach((doc) => {
    const row = doc.data();
    if (row.status !== 'booked') return;
    if (ignoreMeetingId && doc.id === ignoreMeetingId) return;
    busy.push({ start: new Date(row.startMs).toISOString(), end: new Date(row.endMs).toISOString() });
  });
  const lockSnap = await store.locks()
    .where('startMs', '>=', fromMs)
    .where('startMs', '<', toMs)
    .get();
  const now = Date.now();
  lockSnap.forEach((doc) => {
    const row = doc.data();
    if (ignoreMeetingId && row.meetingId === ignoreMeetingId) return;
    if (row.status === 'held' && ignoreHoldToken && row.holdToken === ignoreHoldToken) return;
    if (row.status === 'booked') {
      const end = row.endMs || (row.startMs + 20 * 60000);
      busy.push({ start: new Date(row.startMs).toISOString(), end: new Date(end).toISOString() });
    } else if (row.status === 'held' && row.expiresAt > now) {
      const end = row.endMs || (row.startMs + 20 * 60000);
      busy.push({ start: new Date(row.startMs).toISOString(), end: new Date(end).toISOString() });
    }
  });
  return busy;
}

async function openSlots(type, { ignoreMeetingId, ignoreHoldToken } = {}) {
  const avail = await loadAvailability();
  const durationMin = avail.durations[type];
  if (!durationMin) throw fail(400, 'Choose a meeting.');
  const now = new Date();
  const horizonDays = 14;
  const fromMs = now.getTime();
  const toMs = fromMs + (horizonDays + 1) * 86400000;
  const busy = await busyAndHolds(fromMs, toMs, ignoreMeetingId, ignoreHoldToken);
  const slots = generateSlots({
    now,
    timeZone: avail.timeZone,
    windows: avail.windows,
    exceptions: avail.exceptions,
    durationMin,
    bufferMin: avail.bufferMin,
    leadMin: avail.leadMin,
    horizonDays,
    busy,
  });
  return { slots, timeZone: avail.timeZone, durationMin, type };
}

async function holdSlot({ type, start }) {
  const { slots, durationMin } = await openSlots(type);
  const want = new Date(start).getTime();
  const match = slots.find((s) => new Date(s.start).getTime() === want);
  if (!match) throw fail(409, 'That time is no longer open.');
  const holdToken = crypto.randomBytes(18).toString('base64url');
  const startMs = want;
  const endMs = new Date(match.end).getTime();
  await store.locks().doc(String(startMs)).set({
    status: 'held',
    holdToken,
    startMs,
    endMs,
    type,
    expiresAt: Date.now() + HOLD_MS,
  });
  return { holdToken, start: match.start, end: match.end, durationMin, expiresIn: HOLD_MS / 1000 };
}

async function takeLock(startMs, endMs, meetingId, holdToken) {
  const ref = store.locks().doc(String(startMs));
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists) {
      const row = snap.data();
      const heldByUs = row.status === 'held' && row.holdToken === holdToken && row.expiresAt > now;
      const freeHold = row.status === 'held' && row.expiresAt <= now;
      const ours = row.meetingId === meetingId && row.status === 'booked';
      if (!heldByUs && !freeHold && !ours && row.status !== undefined) {
        if (!(row.status === 'held' && !holdToken && row.expiresAt <= now)) {
          if (row.status === 'booked' && row.meetingId !== meetingId) throw fail(409, 'That time is no longer open.');
          if (row.status === 'held' && row.expiresAt > now && row.holdToken !== holdToken) {
            throw fail(409, 'That time is no longer open.');
          }
        }
      }
    }
    tx.set(ref, { status: 'booked', meetingId, startMs, endMs });
  });
}

async function releaseLock(startMs, meetingId) {
  const ref = store.locks().doc(String(startMs));
  const snap = await ref.get();
  if (snap.exists && snap.data().meetingId === meetingId) await ref.delete();
}

function publicMeeting(doc) {
  const row = doc.data ? doc.data() : doc;
  const id = doc.id || row.id;
  return {
    id,
    type: row.type,
    status: row.status,
    start: new Date(row.startMs).toISOString(),
    end: new Date(row.endMs).toISOString(),
    name: row.name,
    business: row.business,
    when: formatWhen(row.startMs, row.timeZone),
  };
}

async function emailMeeting(meeting, kind) {
  const when = formatWhen(meeting.startMs, meeting.timeZone);
  const manage = siteUrl() + '/book/manage/?t=' + meeting.id;
  const video = meetUrl();
  const verb = kind === 'reschedule' ? 'moved' : 'booked';
  const summary = meeting.type === 'discovery'
    ? 'Algorithmacy Studio — 20-minute call'
    : 'Algorithmacy Studio — ' + meeting.type;
  const text = [
    'Your call is ' + verb + '.',
    '',
    when,
    meeting.business ? 'Business: ' + meeting.business : '',
    video ? 'Link: ' + video : 'The video link is in this email when it is set. Roger will send it if it is not here.',
    '',
    'Change or cancel: ' + manage,
    '',
    'Nothing is connected on a first call.',
  ].filter((line) => line !== undefined).join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px">
    <p>Your call is ${escapeHtml(verb)}.</p>
    <p><strong>${escapeHtml(when)}</strong></p>
    ${video ? `<p>Link: <a href="${escapeHtml(video)}">${escapeHtml(video)}</a></p>` : '<p>Roger will send the video link if it is not already in this note.</p>'}
    <p><a href="${escapeHtml(manage)}">Change or cancel</a></p>
  </div>`;
  const ics = buildIcs({
    uid: meeting.id + '@algorithmacy.org',
    start: meeting.startMs,
    end: meeting.endMs,
    summary,
    description: text,
    organizer: process.env.EMAIL_FROM || ROGER,
    attendee: meeting.email,
    url: video || manage,
  });
  await sendMail({ to: meeting.email, subject: 'Studio — ' + when, text, html, ics, replyTo: ROGER });
  await sendMail({
    to: ROGER,
    replyTo: meeting.email,
    subject: 'Studio call — ' + meeting.business,
    text: [meeting.name, meeting.email, meeting.business, meeting.type, when, meeting.note || '', manage].join('\n'),
    html: `<p>${escapeHtml(meeting.name)} · ${escapeHtml(meeting.email)}</p><p>${escapeHtml(meeting.business)}</p><p>${escapeHtml(when)}</p>`,
  });
}

async function createMeeting({ type, start, name, email, business, note, accountId, holdToken }) {
  const opened = await openSlots(type, { ignoreHoldToken: holdToken });
  const want = new Date(start).getTime();
  const match = opened.slots.find((s) => new Date(s.start).getTime() === want);
  if (!match) throw fail(409, 'That time is no longer open.');
  const id = crypto.randomBytes(24).toString('base64url');
  const startMs = want;
  const endMs = new Date(match.end).getTime();
  await takeLock(startMs, endMs, id, holdToken);
  const avail = await loadAvailability();
  const row = {
    type,
    status: 'booked',
    startMs,
    endMs,
    timeZone: avail.timeZone,
    name,
    email,
    business,
    note: note || '',
    accountId: accountId || '',
    createdAt: new Date().toISOString(),
    remind24At: '',
    remind1At: '',
  };
  await store.meetings().doc(id).set(row);
  const meeting = { id, ...row };
  try {
    await emailMeeting(meeting, 'book');
  } catch (e) {
    console.error('studio meeting email', e);
  }
  try {
    await store.addLead({
      source: 'book',
      name,
      email,
      business,
      office: '',
      chore: note || type,
      intent: type,
      meetingId: id,
      start: new Date(startMs).toISOString(),
    });
  } catch (e) {
    console.error('studio meeting lead', e);
  }
  return {
    id,
    when: formatWhen(startMs, avail.timeZone),
    start: match.start,
    end: match.end,
    manageUrl: '/book/manage/?t=' + id,
    video: meetUrl(),
  };
}

async function meetingByToken(token) {
  if (!token || token.length < 16 || token.length > 80) throw fail(404, 'That link is not valid.');
  const snap = await store.meetings().doc(token).get();
  if (!snap.exists) throw fail(404, 'That link is not valid.');
  return { id: snap.id, ...snap.data() };
}

async function cancelMeeting(meeting) {
  if (meeting.status === 'cancelled') return publicMeeting(meeting);
  await store.meetings().doc(meeting.id).update({ status: 'cancelled', cancelledAt: new Date().toISOString() });
  await releaseLock(meeting.startMs, meeting.id);
  const when = formatWhen(meeting.startMs, meeting.timeZone);
  try {
    await sendMail({
      to: meeting.email,
      replyTo: ROGER,
      subject: 'Studio — call cancelled',
      text: 'The call on ' + when + ' is cancelled.\n\nBook another: ' + siteUrl() + '/book/',
      html: `<p>The call on ${escapeHtml(when)} is cancelled.</p><p><a href="${siteUrl()}/book/">Book another</a></p>`,
    });
    await sendMail({
      to: ROGER,
      replyTo: meeting.email,
      subject: 'Studio call cancelled — ' + meeting.business,
      text: [meeting.name, meeting.email, when].join('\n'),
      html: `<p>${escapeHtml(meeting.name)} cancelled ${escapeHtml(when)}.</p>`,
    });
  } catch (e) {
    console.error('studio cancel email', e);
  }
  return { ...publicMeeting(meeting), status: 'cancelled' };
}

async function rescheduleMeeting(meeting, start) {
  if (meeting.status !== 'booked') throw fail(400, 'That call is already cancelled.');
  const opened = await openSlots(meeting.type, { ignoreMeetingId: meeting.id });
  const want = new Date(start).getTime();
  const match = opened.slots.find((s) => new Date(s.start).getTime() === want);
  if (!match) throw fail(409, 'That time is no longer open.');
  const endMs = new Date(match.end).getTime();
  await takeLock(want, endMs, meeting.id, '');
  await releaseLock(meeting.startMs, meeting.id);
  await store.meetings().doc(meeting.id).update({
    startMs: want,
    endMs,
    remind24At: '',
    remind1At: '',
  });
  const next = { ...meeting, startMs: want, endMs };
  try { await emailMeeting(next, 'reschedule'); }
  catch (e) { console.error('studio reschedule email', e); }
  return publicMeeting({ id: meeting.id, ...next, data: () => next });
}

async function listAccountMeetings(accountId) {
  const snap = await store.meetings().where('accountId', '==', accountId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...publicMeeting(d), email: d.data().email, note: d.data().note || '' }))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

async function handleBook(req, res) {
  if (req.method === 'GET') {
    const icsToken = queryValue(req, 'ics');
    if (icsToken) {
      const meeting = await meetingByToken(icsToken);
      const file = buildIcs({
        uid: meeting.id + '@algorithmacy.org',
        start: meeting.startMs,
        end: meeting.endMs,
        summary: 'Algorithmacy Studio',
        description: formatWhen(meeting.startMs, meeting.timeZone),
        organizer: process.env.EMAIL_FROM || ROGER,
        attendee: meeting.email,
        url: meetUrl() || siteUrl() + '/book/',
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="studio-meeting.ics"');
      res.end(file);
      return;
    }
    const token = queryValue(req, 't') || queryValue(req, 'manage');
    if (token) {
      const meeting = await meetingByToken(token);
      return send(res, 200, { meeting: publicMeeting(meeting) });
    }
    const type = queryValue(req, 'type') || 'discovery';
    if (type !== 'discovery') throw fail(400, 'Book that meeting from the portal.');
    const opened = await openSlots('discovery');
    return send(res, 200, opened);
  }

  if (req.method !== 'POST') throw fail(405, 'Method not allowed.');
  const body = await readJson(req);
  if (body.website) return send(res, 200, { ok: true });

  if (body.action === 'cancel') {
    const meeting = await meetingByToken(body.token || body.t);
    return send(res, 200, { meeting: await cancelMeeting(meeting) });
  }
  if (body.action === 'reschedule') {
    const meeting = await meetingByToken(body.token || body.t);
    const when = new Date(body.start);
    if (Number.isNaN(when.getTime())) throw fail(400, 'Choose a time.');
    return send(res, 200, { meeting: await rescheduleMeeting(meeting, when.toISOString()) });
  }
  if (body.action === 'slots') {
    const token = typeof body.token === 'string' ? body.token : '';
    if (token) {
      const meeting = await meetingByToken(token);
      return send(res, 200, await openSlots(meeting.type, { ignoreMeetingId: meeting.id }));
    }
    if (body.type !== 'discovery') throw fail(400, 'Book that meeting from the portal.');
    return send(res, 200, await openSlots('discovery'));
  }
  if (body.action === 'hold') {
    const type = body.type === 'discovery' ? 'discovery' : '';
    if (!type) throw fail(400, 'Choose a meeting.');
    return send(res, 200, await holdSlot({ type, start: body.start }));
  }

  const { errors, clean } = validateBook(body);
  if (errors.length) throw fail(400, errors[0]);
  if (clean.type !== 'discovery') throw fail(400, 'Book that meeting from the portal.');
  await core.enforceRate({
    email: clean.email,
    ip: clientIp(req),
    bucket: 'studio:book',
    message: 'Too many attempts. Please try again in an hour.',
  });
  const booked = await createMeeting({ ...clean, accountId: '' });
  return send(res, 200, { ok: true, meeting: booked });
}

module.exports = {
  openSlots,
  holdSlot,
  createMeeting,
  cancelMeeting,
  rescheduleMeeting,
  meetingByToken,
  listAccountMeetings,
  handleBook,
  publicMeeting,
  loadAvailability,
};
