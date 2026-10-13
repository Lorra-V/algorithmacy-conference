const REPO = 'https://github.com/rogerSuperBuilderAlpha/algorithmacy-conference';

const YOUR_ENGINEERS_STEP = 'In studio/index.html, find “Your Engineers.” Copy either person block and put yours after it. Change the photo path, your name, two sentences a client could read, and your LinkedIn link.';
const NOT_SIGNED_IN = 'It does not sign you in.';

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
    'Then add your photo and two sentences on the Studio page, under Your Engineers. This pull request is only the public profile. ' + NOT_SIGNED_IN,
    '',
    '1. Fork ' + task.repo + '.',
    '2. Add a square photo at ' + task.photo + '.',
    '3. ' + YOUR_ENGINEERS_STEP,
    '4. Open a pull request to main.',
    '',
    'Do not include a client name, a key, or a document in that pull request.',
  ].join('\n');
}

function engineerApplicationText(name) {
  const photo = 'images/speakers/' + slug(name || '', '') + '.jpg';
  return [
    'The pull request is the application. A pull request does not sign anyone in. ' + NOT_SIGNED_IN,
    '',
    '1. Fork ' + REPO + '.',
    '2. Add a square photo at ' + photo + '. Use the name in lowercase, with hyphens.',
    '3. ' + YOUR_ENGINEERS_STEP,
    '4. Put the sign-in email, one chore, who signs off, and one sample report in the pull request description. Those stay off the public page.',
    '5. Open the pull request to main. Title it “Add your name to the Studio engineers.”',
    '',
    'Sign-in works only after an invite to that email. Merging the page and sending the invite are two decisions. A pull request that is closed without a merge does neither.',
    '',
    'Do not include a client name, a key, a transcript, or a document in that pull request.',
  ].join('\n');
}

module.exports = {
  REPO,
  YOUR_ENGINEERS_STEP,
  NOT_SIGNED_IN,
  slug,
  engineerTask,
  engineerInviteText,
  engineerApplicationText,
};
