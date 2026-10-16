const store = require('./db');
const { sendMail } = require('./mail');
const { formatWhen, partsInZone, zonedTimeToUtc } = require('./slots');
const { siteUrl, escapeHtml } = require('./http');

const ROGER = 'roger@algorithmacy.org';

async function once(jobId) {
  const ref = store.jobs().doc(jobId);
  const snap = await ref.get();
  if (snap.exists) return false;
  await ref.set({ at: new Date().toISOString() });
  return true;
}

async function reminders(now = new Date()) {
  const windows = [
    { flag: 'remind24At', from: now.getTime() + 20 * 3600000, to: now.getTime() + 28 * 3600000, label: 'tomorrow' },
    { flag: 'remind1At', from: now.getTime() + 30 * 60000, to: now.getTime() + 90 * 60000, label: 'in about an hour' },
  ];
  let sent = 0;
  for (const w of windows) {
    const snap = await store.meetings().where('startMs', '>=', w.from).where('startMs', '<', w.to).get();
    for (const doc of snap.docs) {
      const row = doc.data();
      if (row.status !== 'booked' || row[w.flag]) continue;
      const when = formatWhen(row.startMs, row.timeZone);
      const manage = siteUrl() + '/book/manage/?t=' + doc.id;
      const text = `Your Studio call is ${w.label}, ${when}.\n\nChange or cancel: ${manage}`;
      try {
        await sendMail({
          to: row.email,
          replyTo: ROGER,
          subject: 'Studio — call ' + w.label,
          text,
          html: `<p>Your Studio call is ${escapeHtml(w.label)}, <strong>${escapeHtml(when)}</strong>.</p><p><a href="${escapeHtml(manage)}">Change or cancel</a></p>`,
        });
        await doc.ref.update({ [w.flag]: new Date().toISOString() });
        sent += 1;
      } catch (e) {
        console.error('studio reminder', e);
      }
    }
  }
  return { sent };
}

function weekId(now) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

async function digest(now = new Date()) {
  const id = 'digest-' + weekId(now);
  if (!(await once(id))) return { skipped: true };
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const accounts = await store.listAccounts();
  let sent = 0;
  for (const acc of accounts) {
    if (acc.status === 'cancelled') continue;
    const activity = (await store.listActivity(acc.id, { limit: 40 })).filter((row) => row.ts >= since);
    const lines = activity.slice(0, 12).map((row) => '- ' + row.summary);
    const text = [
      acc.office,
      '',
      activity.length
        ? 'This week the agents posted ' + activity.length + ' update' + (activity.length === 1 ? '' : 's') + '.'
        : 'No agent activity was posted this week.',
      '',
      ...lines,
      '',
      'Portal: ' + siteUrl() + '/portal/',
    ].join('\n');
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">
      <p>${escapeHtml(activity.length ? 'This week the agents posted ' + activity.length + ' updates.' : 'No agent activity was posted this week.')}</p>
      ${lines.map((l) => `<p>${escapeHtml(l.slice(2))}</p>`).join('')}
      <p><a href="${siteUrl()}/portal/">Open the portal</a></p>
    </div>`;
    for (const member of acc.members || []) {
      if (!member.email || member.digest === false) continue;
      try {
        await sendMail({
          to: member.email,
          replyTo: ROGER,
          subject: 'Studio — week of ' + acc.office,
          text,
          html,
        });
        sent += 1;
      } catch (e) {
        console.error('studio digest', e);
      }
    }
  }
  return { sent };
}

function previousMonth(now, timeZone) {
  const parts = partsInZone(now, timeZone);
  let year = +parts.year;
  let month = +parts.month - 1;
  if (month < 1) { month = 12; year -= 1; }
  const start = zonedTimeToUtc(year, month, 1, 0, 0, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = zonedTimeToUtc(nextYear, nextMonth, 1, 0, 0, timeZone);
  const key = year + '-' + String(month).padStart(2, '0');
  return { key, start: start.toISOString(), end: end.toISOString() };
}

async function writeReport(acc, month) {
  const activity = await store.listActivity(acc.id, { limit: 200 });
  const rows = activity.filter((row) => row.ts >= month.start && row.ts < month.end);
  const counts = { did: 0, needs_approval: 0, blocked: 0, error: 0, note: 0 };
  for (const row of rows) if (counts[row.type] != null) counts[row.type] += 1;
  const highlights = rows.slice(0, 8).map((row) => row.summary);
  await store.saveReport(acc.id, month.key, { counts, highlights, total: rows.length });
  return { counts, highlights, total: rows.length, month: month.key };
}

async function reports(now = new Date()) {
  const { loadAvailability } = require('./booking');
  const avail = await loadAvailability();
  const month = previousMonth(now, avail.timeZone || 'America/New_York');
  if (!(await once('report-' + month.key))) return { skipped: true };
  const accounts = await store.listAccounts();
  let written = 0;
  for (const acc of accounts) {
    if (acc.status === 'cancelled') continue;
    const report = await writeReport(acc, month);
    const text = [
      'Studio report for ' + month.key,
      acc.office,
      '',
      report.total + ' updates.',
      ...report.highlights.map((h) => '- ' + h),
      '',
      siteUrl() + '/portal/reports/',
    ].join('\n');
    for (const member of acc.members || []) {
      if (!member.email || member.digest === false) continue;
      try {
        await sendMail({
          to: member.email,
          replyTo: ROGER,
          subject: 'Studio — ' + month.key + ' report',
          text,
          html: `<p>Studio report for ${escapeHtml(month.key)}. ${report.total} updates.</p><p><a href="${siteUrl()}/portal/reports/">Open the report</a></p>`,
        });
      } catch (e) {
        console.error('studio report email', e);
      }
    }
    written += 1;
  }
  return { written, month: month.key };
}

async function auditRetention() {
  return store.pruneAudit();
}

async function run(job) {
  if (job === 'reminders') return reminders();
  if (job === 'digest') return digest();
  if (job === 'reports') return reports();
  if (job === 'audit') return auditRetention();
  const err = new Error('Unknown job.');
  err.status = 400;
  throw err;
}

module.exports = { run, reminders, digest, reports, auditRetention, writeReport, previousMonth, weekId };
