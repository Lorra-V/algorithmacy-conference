async function recordLead(clean) {
  const { configured } = require('./firebase-admin');
  if (!configured()) return;
  const { addLead } = require('./db');
  await addLead({
    source: 'studio-form',
    intent: clean.intent,
    name: clean.name,
    email: clean.email,
    business: clean.business,
    office: clean.office || '',
    chore: clean.chore || clean.message || '',
    phone: clean.phone || '',
  });
}

module.exports = { recordLead };
