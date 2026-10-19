const { publishedEngineer } = require('./published-engineers');
const { signInEmail } = require('./engineer-applications');

const raw = require('./studio-engineers.json');

function cleanEmail(email) {
  return signInEmail('Sign-in email: ' + String(email || '').trim());
}

function listedEngineers() {
  const rows = Array.isArray(raw) ? raw : (raw.engineers || []);
  return rows.filter((row) => row && row.name).map((row) => ({
    name: String(row.name).trim(),
    email: cleanEmail(row.email),
    github: String(row.github || '').trim(),
    pr: Number(row.pr) || 0,
  }));
}

function decorate(row) {
  const published = publishedEngineer(row.name);
  return {
    name: published ? published.name : row.name,
    email: row.email,
    github: row.github,
    pr: row.pr,
    published: Boolean(published),
  };
}

function matchDirectoryEmail(email) {
  const address = cleanEmail(email);
  if (!address) return null;
  const row = listedEngineers().find((person) => person.email === address);
  return row ? decorate(row) : null;
}

function matchDirectoryGithub(login) {
  const github = String(login || '').trim().toLowerCase();
  if (!github) return null;
  const row = listedEngineers().find((person) => person.github.toLowerCase() === github);
  return row ? decorate(row) : null;
}

module.exports = { listedEngineers, matchDirectoryEmail, matchDirectoryGithub };
