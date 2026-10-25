const NOTE_LIMIT = 4000;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeSetting(value) {
  const raw = clean(value);
  const v = raw.toLowerCase();
  if (!v) return '';
  if (v === 'home' || v === 'household' || v.includes('home')) return 'home';
  if (v === 'office' || v.includes('business') || v.includes('practice') || v.includes('clinic') || v.includes('firm') || v.includes('shop')) return 'office';
  return raw.slice(0, 80);
}

function normalizeOffer(value) {
  const raw = clean(value);
  const v = raw.toLowerCase().replace(/[\s_]+/g, '-');
  if (!v) return '';
  if (v === 'first-10' || v === 'first10' || v.includes('first')) return 'first-10';
  if (v === 'standard' || v === 'guide') return 'standard';
  return raw.slice(0, 40);
}

function settingLabel(setting) {
  if (setting === 'home') return 'home / household';
  if (setting === 'office') return 'office';
  return setting;
}

function offerLabel(offer) {
  if (offer === 'first-10') return 'First 10 free labor and free maintenance for life';
  if (offer === 'standard') return 'Standard guideline pricing';
  return offer;
}

export function composeBookingNote(fields) {
  const lines = [];
  if (fields.summary) lines.push(fields.summary);
  if (fields.notes && fields.notes !== fields.summary) lines.push(fields.notes);
  const bits = [];
  if (fields.setting) bits.push('Setting: ' + settingLabel(fields.setting));
  if (fields.software) bits.push('Software: ' + fields.software);
  if (fields.users) bits.push('Daily users: ' + fields.users);
  if (fields.offer) bits.push('Offer: ' + offerLabel(fields.offer));
  if (fields.priority) bits.push('Priority: ' + fields.priority);
  if (fields.tier) bits.push('Hardware tier: ' + fields.tier);
  if (bits.length) lines.push(bits.join('. ') + '.');
  return lines.join('\n\n').slice(0, NOTE_LIMIT);
}

export function bookingPrefill(search) {
  const raw = clean(search);
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const get = (key) => clean(params.get(key));
  const fields = {
    setting: normalizeSetting(get('setting')),
    org: get('org') || get('business') || get('office'),
    software: get('software') || get('stack'),
    users: get('users') || get('people'),
    offer: normalizeOffer(get('offer')),
    summary: get('summary'),
    name: get('name'),
    email: get('email'),
    notes: get('notes') || get('note'),
    priority: get('priority'),
    tier: get('tier'),
  };
  const note = composeBookingNote(fields);
  const any = Object.values(fields).some(Boolean);
  return { ...fields, note, any };
}
