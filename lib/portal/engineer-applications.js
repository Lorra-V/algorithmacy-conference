const REPO = process.env.GITHUB_REPO || 'rogerSuperBuilderAlpha/algorithmacy-conference';

function signInEmail(text) {
  const source = String(text || '')
    .replace(/\[([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\]\(mailto:[^)]+\)/gi, '$1');
  const match = source.match(/(?:sign-in email|studio login email)\s*:\s*\**\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (!match) return '';
  const email = match[1].toLowerCase();
  if (email.endsWith('.noreply.github.com') || email === 'cursoragent@cursor.com') return '';
  return email;
}

function addedEngineerName(patch) {
  const match = String(patch || '').match(/^\+[^\n]*<h3>([^<]+)<\/h3>/m);
  return match ? match[1].trim() : '';
}

function humanLogin(pull, commits) {
  const opener = pull && pull.user && pull.user.login ? String(pull.user.login) : '';
  if (opener && opener !== 'cursoragent') return opener;
  const list = Array.isArray(commits) ? commits : [];
  for (const commit of list) {
    const author = commit && commit.author && commit.author.login ? String(commit.author.login) : '';
    if (author && author !== 'cursoragent') return author;
    const committer = commit && commit.committer && commit.committer.login ? String(commit.committer.login) : '';
    if (committer && committer !== 'cursoragent') return committer;
  }
  return '';
}

function applicationFromPull(pull, patch, commits) {
  const login = humanLogin(pull, commits);
  const name = addedEngineerName(patch);
  if (!login || !name) return null;
  return {
    pr: pull.number,
    url: pull.html_url || '',
    merged: Boolean(pull.merged_at),
    login,
    name,
    email: signInEmail(pull.body),
  };
}

async function githubFetch(path, fetcher) {
  const token = process.env.GITHUB_TOKEN || '';
  if (!token) {
    const err = new Error('Pull requests cannot be listed yet.');
    err.status = 422;
    throw err;
  }
  const request = fetcher || fetch;
  const res = await request('https://api.github.com' + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'algorithmacy-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const err = new Error('Pull requests cannot be listed yet.');
    err.status = 422;
    throw err;
  }
  return res.json();
}

async function listEngineerApplications(fetcher) {
  const pulls = await githubFetch('/repos/' + REPO + '/pulls?state=all&per_page=50', fetcher);
  const list = Array.isArray(pulls) ? pulls : [];
  const found = [];
  for (const pull of list) {
    const text = (pull.title || '') + '\n' + (pull.body || '');
    if (!/engineer/i.test(text)) continue;
    const files = await githubFetch('/repos/' + REPO + '/pulls/' + pull.number + '/files?per_page=100', fetcher);
    const page = (Array.isArray(files) ? files : []).find((file) => file.filename === 'studio/index.html');
    let commits = [];
    if (pull.user && pull.user.login === 'cursoragent') {
      commits = await githubFetch('/repos/' + REPO + '/pulls/' + pull.number + '/commits?per_page=100', fetcher);
    }
    const application = applicationFromPull(pull, page && page.patch, commits);
    if (application) found.push(application);
  }
  return found.sort((a, b) => b.pr - a.pr);
}

async function githubAccount(token, fetcher) {
  const access = String(token || '').trim();
  if (!access || access.length > 2000) return null;
  const request = fetcher || fetch;
  const headers = {
    Authorization: 'Bearer ' + access,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'algorithmacy-studio',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const userRes = await request('https://api.github.com/user', { headers });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  const login = user && user.login ? String(user.login) : '';
  if (!login) return null;
  let email = signInEmail('Sign-in email: ' + (user.email || ''));
  if (!email) {
    const mailRes = await request('https://api.github.com/user/emails', { headers });
    if (mailRes.ok) {
      const rows = await mailRes.json();
      const primary = (Array.isArray(rows) ? rows : []).find((row) => row && row.primary && row.verified);
      email = signInEmail('Sign-in email: ' + (primary && primary.email || ''));
    }
  }
  return { login, email };
}

module.exports = {
  signInEmail,
  addedEngineerName,
  applicationFromPull,
  listEngineerApplications,
  githubAccount,
};
