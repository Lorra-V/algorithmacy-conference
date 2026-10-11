const crypto = require('node:crypto');

async function sendMail({ to, subject, text, html, ics, replyTo }) {
  const domain = process.env.EMAIL_DOMAIN;
  const apiKey = process.env.EMAIL_API_KEY;
  const fromAddr = process.env.EMAIL_FROM;
  const apiBase = (process.env.EMAIL_API_BASE || 'https://api.mailgun.net').replace(/\/$/, '');
  if (!domain || !apiKey || !fromAddr) {
    const err = new Error('Email is not configured.');
    err.status = 503;
    throw err;
  }

  const boundary = '----studio' + crypto.randomBytes(12).toString('hex');
  const chunks = [];
  const push = (s) => chunks.push(Buffer.from(s, 'utf8'));
  const field = (name, value) => {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  };
  field('from', `Algorithmacy Studio <${fromAddr}>`);
  field('to', Array.isArray(to) ? to.join(',') : to);
  field('subject', subject);
  field('text', text);
  if (html) field('html', html);
  field('o:tag', 'algorithmacy-studio');
  if (replyTo) field('h:Reply-To', replyTo);
  if (ics) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="studio-meeting.ics"\r\nContent-Type: text/calendar; charset=utf-8\r\n\r\n`,
    );
    chunks.push(Buffer.from(ics, 'utf8'));
    push('\r\n');
  }
  push(`--${boundary}--\r\n`);

  const resp = await fetch(`${apiBase}/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64'),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(chunks),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`mailgun ${resp.status}: ${detail.slice(0, 300)}`);
  }
}

module.exports = { sendMail };
