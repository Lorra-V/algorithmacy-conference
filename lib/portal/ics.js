function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function fold(line) {
  const out = [];
  let rest = line;
  let first = true;
  while (rest.length > 75) {
    const take = first ? 75 : 74;
    out.push((first ? '' : ' ') + rest.slice(0, take));
    rest = rest.slice(take);
    first = false;
  }
  out.push((first ? '' : ' ') + rest);
  return out.join('\r\n');
}

function buildIcs({ uid, start, end, summary, description, organizer, attendee, url }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Algorithmacy Studio//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + stamp(new Date()),
    'DTSTART:' + stamp(new Date(start)),
    'DTEND:' + stamp(new Date(end)),
    'SUMMARY:' + escapeText(summary),
    'DESCRIPTION:' + escapeText(description),
    'ORGANIZER:mailto:' + organizer,
    'ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:' + attendee,
  ];
  if (url) lines.push('URL:' + url);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs, escapeText, stamp };
