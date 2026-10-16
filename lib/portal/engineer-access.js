const store = require('./db');
const { publishedEngineer } = require('./published-engineers');
const { matchDirectoryEmail, matchDirectoryGithub } = require('./engineer-directory');

function savedEngineer(row, listed) {
  return {
    id: row.id,
    name: listed.name,
    email: listed.email || row.email || '',
    github: listed.github || row.github || '',
    pr: listed.pr || row.pr || 0,
    status: row.status || 'pending',
    profile: row.profile || 'needed',
  };
}

async function materialize(listed, extra) {
  const prior = extra || {};
  const row = await store.saveEngineerInvite({
    email: listed.email || prior.email || '',
    name: listed.name,
    github: listed.github || prior.github || '',
    pr: listed.pr || prior.pr || 0,
  });
  return savedEngineer(row, listed);
}

async function engineerForEmail(email) {
  const existing = await store.engineerInviteFor(email);
  if (existing && publishedEngineer(existing.name)) {
    return { engineer: existing, reason: '', seeded: false };
  }
  const listed = matchDirectoryEmail(email);
  if (listed && listed.published) {
    return { engineer: await materialize(listed, existing), reason: '', seeded: true };
  }
  if (existing || listed) {
    return { engineer: null, reason: 'engineer profile is not published', seeded: false };
  }
  return { engineer: null, reason: 'no account, pending invite, or admin role', seeded: false };
}

async function engineerForGithub(login) {
  let existing = await store.engineerInviteForGithub(login);
  const listed = matchDirectoryGithub(login);
  if (!existing && listed && listed.github && listed.github !== login) {
    existing = await store.engineerInviteForGithub(listed.github);
  }
  if (existing && publishedEngineer(existing.name)) {
    return { engineer: existing, published: true, known: true, seeded: false };
  }
  if (listed && listed.published) {
    return { engineer: await materialize(listed, existing), published: true, known: true, seeded: true };
  }
  if (existing || listed) return { engineer: null, published: false, known: true, seeded: false };
  return { engineer: null, published: false, known: false, seeded: false };
}

module.exports = { engineerForEmail, engineerForGithub };
