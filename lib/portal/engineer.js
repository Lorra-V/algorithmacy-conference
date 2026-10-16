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
  return [
    name + ', Roger invited you to Algorithmacy Studio as an engineer.',
    '',
    'Sign in with ' + email + '. The page will send a one-time link:',
    link,
    '',
    'The portal then asks for a code from an authenticator app. The email address alone does not open it.',
    '',
    'Your photo and profile are already on the Studio page, under Your Engineers. This invite is what opens sign-in.',
    '',
    'Do not include a client name, a key, or a document in a pull request.',
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
    '4. In lib/portal/studio-engineers.json, add your name, your GitHub login, and your sign-in email. Leave the email blank only if you will sign in with GitHub. A noreply address does not count.',
    '5. Put one chore, who signs off, and one sample report in the pull request description. Those stay off the public page. On its own line you may also write: Sign-in email: you@example.com',
    '6. Open the pull request to main. Title it “Add your name to the Studio engineers.”',
    '',
    'Access starts after that pull request is merged and the engineer row is on main. The email in that row receives the magic link. The GitHub login in that row can sign in when the email is blank. Opening the pull request does not merge it, and merging the page alone does not sign anyone in.',
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
