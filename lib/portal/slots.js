const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const DEFAULT_AVAILABILITY = {
  timeZone: 'America/New_York',
  bufferMin: 15,
  leadMin: 120,
  durations: { discovery: 20, checkpoint: 30, monthly: 30 },
  windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: '10:00', end: '16:00' })),
  exceptions: [],
};

function partsInZone(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  if (out.hour === '24') out.hour = '00';
  return out;
}

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  let t = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 4; i++) {
    const got = partsInZone(new Date(t), timeZone);
    const gotUtc = Date.UTC(+got.year, +got.month - 1, +got.day, +got.hour, +got.minute);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    const delta = want - gotUtc;
    if (delta === 0) break;
    t += delta;
  }
  return new Date(t);
}

function dateKey(year, month, day) {
  return String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function addDays(year, month, day, n) {
  const dt = new Date(Date.UTC(year, month - 1, day + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function parseHM(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function generateSlots(opts) {
  const timeZone = opts.timeZone || 'America/New_York';
  const durationMin = opts.durationMin;
  const bufferMin = opts.bufferMin || 0;
  const stepMin = opts.stepMin || 30;
  const leadMin = opts.leadMin == null ? 120 : opts.leadMin;
  const horizonDays = opts.horizonDays || 14;
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now);
  const windows = opts.windows || [];
  const exceptions = opts.exceptions || [];
  const busy = opts.busy || [];
  const holds = new Set(opts.holds || []);
  if (!durationMin || durationMin < 1) return [];

  const startLocal = partsInZone(now, timeZone);
  let cursor = { year: +startLocal.year, month: +startLocal.month, day: +startLocal.day };
  const slots = [];
  const earliest = now.getTime() + leadMin * 60000;

  for (let d = 0; d < horizonDays; d++) {
    const key = dateKey(cursor.year, cursor.month, cursor.day);
    const exception = exceptions.find((e) => e.date === key);
    const noon = zonedTimeToUtc(cursor.year, cursor.month, cursor.day, 12, 0, timeZone);
    const dow = WEEKDAYS[partsInZone(noon, timeZone).weekday];
    let dayWindows = windows.filter((w) => w.dow === dow);
    if (exception && exception.closed) dayWindows = [];
    else if (exception && exception.start && exception.end) {
      dayWindows = [{ dow, start: exception.start, end: exception.end }];
    }
    for (const w of dayWindows) {
      const open = parseHM(w.start);
      const close = parseHM(w.end);
      for (let min = open; min + durationMin <= close; min += stepMin) {
        const start = zonedTimeToUtc(
          cursor.year, cursor.month, cursor.day, Math.floor(min / 60), min % 60, timeZone,
        );
        const end = new Date(start.getTime() + durationMin * 60000);
        if (start.getTime() < earliest) continue;
        const iso = start.toISOString();
        if (holds.has(iso)) continue;
        const blockStart = start.getTime() - bufferMin * 60000;
        const blockEnd = end.getTime() + bufferMin * 60000;
        const hit = busy.some((b) => overlaps(
          blockStart,
          blockEnd,
          new Date(b.start).getTime(),
          new Date(b.end).getTime(),
        ));
        if (hit) continue;
        slots.push({ start: iso, end: end.toISOString() });
      }
    }
    cursor = addDays(cursor.year, cursor.month, cursor.day, 1);
  }
  return slots;
}

function formatWhen(iso, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

module.exports = {
  DEFAULT_AVAILABILITY,
  partsInZone,
  zonedTimeToUtc,
  generateSlots,
  formatWhen,
  overlaps,
};
