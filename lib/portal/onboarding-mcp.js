// Public Studio onboarding connector. No key and no OAuth.
// A call does not create an account. A pull request does not sign an engineer in.

const core = require('../submission-core');
const booking = require('./booking');
const { validateBook } = require('./validate');
const { formatWhen } = require('./slots');
const { siteUrl } = require('./http');
const { engineerApplicationText } = require('./engineer');
const studio = require('../../handlers/studio');

const SERVER_INFO = { name: 'algorithmacy-studio-onboarding', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const NOT_AN_ACCOUNT = 'This call is not an account. If the work fits, an invite to the portal arrives at this email after the call. Until then, sign-in will not find them.';
const CALENDAR_CLOSED = 'The calendar is not open yet. Write to topanga@algorithmacy.org.';

const TOOLS = [
  {
    name: 'studio_offer',
    description: 'What Algorithmacy Studio is, what it costs, and that a call is not an account or a contract.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_discovery_times',
    description: 'Open times for a 20-minute discovery call. Pass one start value to book_discovery.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'book_discovery',
    description: 'Book one discovery time. Sends the calendar email. Does not create a portal account.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The person booking' },
        email: { type: 'string', description: 'Where the confirmation and any later invite go' },
        business: { type: 'string', description: 'The office' },
        start: { type: 'string', description: 'ISO start from list_discovery_times' },
        note: { type: 'string', description: 'Optional. The chore they want to talk about.' },
      },
      required: ['name', 'email', 'business', 'start'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_studio',
    description: 'Email Algorithmacy Studio. Nothing is booked. The person must have agreed to the Terms of Service and Privacy Policy.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: ['office', 'other'], description: 'office for the engagement, other for different work' },
        office: { type: 'string', enum: studio.OFFICES, description: 'Required when intent is office' },
        name: { type: 'string' },
        business: { type: 'string' },
        email: { type: 'string' },
        message: { type: 'string', description: 'The chore, or the other work' },
        phone: { type: 'string', description: 'Optional' },
        terms: { type: 'boolean', description: 'True only after the person agrees to the Terms of Service and Privacy Policy' },
        website: { type: 'string', description: 'Leave empty.' },
      },
      required: ['intent', 'name', 'business', 'email', 'message', 'terms'],
      additionalProperties: false,
    },
  },
  {
    name: 'engineer_application',
    description: 'How to apply to be an Algorithmacy engineer. Opening the pull request does not sign anyone in.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional. Used only to suggest the photo file name.' },
      },
      additionalProperties: false,
    },
  },
];

function text(t, isError) {
  return { content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) };
}

function lines(rows) {
  return rows.filter(Boolean).join('\n');
}

function studioOffer() {
  return lines([
    'Algorithmacy Studio installs a local model on a computer the client owns, in a small office or a home, and maintains it. Same shape as putting in a water heater: install the computer, set up the daily jobs, maintain them.',
    '',
    'Offices of about 5 to 50 people. Dental practices and clinics first, then law firms, CPA and real estate offices, and other owner-run businesses. Homes too.',
    '',
    'The first 10 offices or homes: setup is free, and maintenance is free for life, for an honest testimonial once it is running. The client supplies the computer or buys it at the store price. After those 10, the guide is $5,000 to set up and $1,000 a month. A given job can cost more or less. For a normal small office or a home, that guide covers it. A call is not a contract. An inquiry is not a contract.',
    '',
    'Someone there approves a new kind of message before it goes out. The model runs on their machine. A dentist still does the clinical work. A lawyer still does the legal work.',
    '',
    'The conference on this site is a separate program. Booking a call does not register anyone for it.',
    '',
    NOT_AN_ACCOUNT + ' People is where the office or household is invited. The first 10 have no setup charge and no monthly charge. After that, Subscription is where the $5,000 setup and the first month are paid.',
    '',
    'To book, call list_discovery_times, then book_discovery. To write first, call write_studio. Nothing is booked by writing.',
    'To apply as an engineer, call engineer_application. Do not use /api/mcp for Studio. Do not use /api/studio-mcp until the pull request is merged, an invite is sent, and the authenticator is set up.',
  ]);
}

function bookDiscoveryReply(meeting) {
  const manage = meeting && meeting.manageUrl ? siteUrl() + meeting.manageUrl : '';
  return lines([
    'Booked.' + (meeting && meeting.when ? ' ' + meeting.when + '.' : ''),
    'A confirmation is on its way, with a calendar file.',
    NOT_AN_ACCOUNT,
    meeting && meeting.video ? 'Link: ' + meeting.video : '',
    manage ? 'Change or cancel: ' + manage : '',
  ]);
}

function calendarClosed(error) {
  return /Firebase is not configured/i.test(String(error && error.message || ''));
}

async function callTool(name, args, ctx) {
  const input = args || {};
  const ip = (ctx && ctx.ip) || '';
  try {
    if (name === 'studio_offer') return text(studioOffer());
    if (name === 'engineer_application') return text(engineerApplicationText(input.name || ''));
    if (name === 'list_discovery_times') {
      await core.enforceRate({
        ip,
        bucket: 'studio:onboarding',
        message: 'Too many requests. Try again in an hour.',
      });
      const opened = await booking.openSlots('discovery');
      const slots = opened.slots || [];
      if (!slots.length) return text('No open times in the next two weeks. Write to topanga@algorithmacy.org.');
      const rows = slots.map((slot) => slot.start + ' · ' + formatWhen(slot.start, opened.timeZone));
      return text(lines([
        'Times are ' + opened.timeZone + '.',
        'Pass one start value to book_discovery.',
        '',
        rows.join('\n'),
      ]));
    }
    if (name === 'book_discovery') {
      const { errors, clean } = validateBook({ ...input, type: 'discovery' });
      if (errors.length) return text(errors.join('\n'), true);
      await core.enforceRate({
        email: clean.email,
        ip,
        bucket: 'studio:book',
        message: 'Too many attempts. Please try again in an hour.',
      });
      const meeting = await booking.createMeeting({ ...clean, accountId: '' });
      return text(bookDiscoveryReply(meeting));
    }
    if (name === 'write_studio') {
      if (studio.honeypotFilled(input)) return text('Sent. Nothing is booked.');
      const { errors, clean } = studio.validateInquiry(input, { skipTimer: true });
      if (errors.length) return text(errors.join('\n'), true);
      await studio.deliverInquiry(clean, { headers: ip ? { 'x-forwarded-for': ip } : {} });
      return text('Sent. Nothing is booked. If we follow up, we will use the email address you gave.');
    }
    return text('Unknown tool: ' + name, true);
  } catch (error) {
    if (error && error.status === 429) return text(error.message, true);
    if (name === 'write_studio') {
      return text(error.message || studio.FRIENDLY_SEND_ERROR, true);
    }
    if (calendarClosed(error)) return text(CALENDAR_CLOSED, true);
    if (error && error.status && error.status < 500) return text(error.message, true);
    if (error && error.status === 503) throw error;
    console.error('onboarding mcp', name, error);
    return text('Something went wrong. Write to topanga@algorithmacy.org.', true);
  }
}

async function handleRpc(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: (msg && msg.id) ?? null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  try {
    if (method === 'initialize') {
      const requested = params && params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Onboard a new Algorithmacy Studio client or engineer. A booked call is not an account. A pull request does not sign an engineer in. Do not pay, and do not pass the authenticator.',
      });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      if (!params || typeof params.name !== 'string') {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params: name required' } };
      }
      const result = await callTool(params.name, params.arguments || {}, ctx);
      return reply(id, result);
    }
    if (isNotification) return null;
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } };
  } catch (error) {
    if (error.status === 503) throw error;
    console.error('onboarding rpc', method, error);
    if (isNotification) return null;
    return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } };
  }
}

function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

module.exports = {
  TOOLS,
  NOT_AN_ACCOUNT,
  callTool,
  handleRpc,
  bookDiscoveryReply,
  studioOffer,
};
