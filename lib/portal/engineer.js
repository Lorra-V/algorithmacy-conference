const REPO = 'https://github.com/rogerSuperBuilderAlpha/algorithmacy-conference';

function slug(name, email) {
  const base = String(name || '').trim() || String(email || '').split('@')[0];
  const cleaned = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'your-name';
}

function engineerTask(name, email) {
  const photo = 'images/speakers/' + slug(name, email) + '.jpg';
  return {
    repo: REPO,
    photo: photo,
    page: REPO + '/blob/main/studio/index.html#engineer',
  };
}

function engineerInviteText({ name, email, link }) {
  const task = engineerTask(name, email);
  return [
    'Roger invited you to Algorithmacy Studio as an engineer.',
    '',
    'Sign in with this email address. The page will send a one-time link:',
    link,
    '',
    'The portal then asks for a code from an authenticator app. The email address alone does not open it.',
    '',
    'Then add your photo and two sentences on the Studio page, under Your Engineers. This pull request is only the public profile. It does not sign you in.',
    '',
    '1. Fork ' + task.repo + '.',
    '2. Add a square photo at ' + task.photo + '.',
    '3. In studio/index.html, find “Your Engineers.” Copy either person block and put yours after it. Change the photo path, your name, two sentences a client could read, and your LinkedIn link.',
    '4. Open a pull request to main.',
    '',
    'Do not include a client name, a key, or a document in that pull request.',
  ].join('\n');
}

module.exports = { REPO, slug, engineerTask, engineerInviteText };
