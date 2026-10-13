// Studio connector. One remote MCP server for Claude, Cursor, and Grok.
// The caller is an OAuth token issued after the authenticator check.
// The connection cannot charge a card or invite another engineer.

const store = require('./db');
const booking = require('./booking');
const { fail, siteUrl, escapeHtml } = require('./http');
const { validateAccountCreate, validateAgent, validateEvent, validateRequest } = require('./validate');
const { sendMail } = require('./mail');

const SERVER_INFO = { name: 'algorithmacy-studio', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const ROGER = 'roger@algorithmacy.org';

const CLIENT = 'client';
const ENGINEER = 'engineer';

function schema(properties, required) {
  return {
    type: 'object',
    properties: properties,
    required: required || [],
    additionalProperties: false,
  };
}

const ACCOUNT = {
  type: 'string',
  description: 'Office id. Required for an engineer. Ignored for a client, whose connection is already one office.',
};

const TOOLS = [
  tool('whoami', 'Who this connection is, and which office it can open.', schema({}), [CLIENT, ENGINEER]),
  tool('list_accounts', 'Offices on Studio: name, kind, status, and billing. Engineer only.', schema({}), [ENGINEER]),
  tool('list_leads', 'People who wrote in or booked a call and are not an account yet. Engineer only.', schema({}), [ENGINEER]),
  tool('create_account', 'Open an office after a call and email the owner a sign-in link. Engineer only. Does not charge a card.', schema({
    office: { type: 'string', description: 'Business name' },
    kind: { type: 'string', description: 'law firm, dental practice or med spa, real estate office, CPA firm, or owner-run office' },
    name: { type: 'string', description: 'Owner name' },
    email: { type: 'string', description: 'Owner email' },
  }, ['office', 'kind', 'name', 'email']), [ENGINEER]),
  tool('create_agent', 'Add an agent to an office. The key is shown once on the account page. Engineer only.', schema({
    accountId: ACCOUNT,
    name: { type: 'string' },
    chore: { type: 'string', description: 'What this agent does, in one sentence' },
  }, ['name', 'chore']), [ENGINEER]),
  tool('set_agent_status', 'Mark an agent learning, running, or paused. Engineer only.', schema({
    accountId: ACCOUNT,
    agentId: { type: 'string' },
    status: { type: 'string', enum: ['learning', 'running', 'paused'] },
  }, ['agentId', 'status']), [ENGINEER]),
  tool('post_report', 'Post the sentence the office will read. Engineer only. One report per run.', schema({
    accountId: ACCOUNT,
    type: { type: 'string', enum: ['did', 'needs_approval', 'blocked', 'error', 'note'] },
    summary: { type: 'string', description: 'One or two sentences a person in the office can read' },
    detail: { type: 'string', description: 'Optional longer note. No documents, no transcript.' },
  }, ['type', 'summary']), [ENGINEER]),
  tool('list_agents', 'Agents set up for the office, and what each one does.', schema({ accountId: ACCOUNT }), [CLIENT, ENGINEER]),
  tool('list_reports', 'Reports posted for the office, newest first.', schema({ accountId: ACCOUNT }), [CLIENT, ENGINEER]),
  tool('subscription', 'Whether the subscription is active, and the price. This connection cannot charge a card.', schema({ accountId: ACCOUNT }), [CLIENT, ENGINEER]),
  tool('list_meetings', 'Calls booked for the office.', schema({ accountId: ACCOUNT }), [CLIENT, ENGINEER]),
  tool('open_times', 'Open times for a check-in or a monthly call.', schema({
    accountId: ACCOUNT,
    type: { type: 'string', enum: ['checkpoint', 'monthly'], description: 'checkpoint is the check-in. monthly is the monthly call.' },
  }, ['type']), [CLIENT, ENGINEER]),
  tool('book_call', 'Book one of the open times. Sends the calendar email.', schema({
    accountId: ACCOUNT,
    type: { type: 'string', enum: ['checkpoint', 'monthly'] },
    start: { type: 'string', description: 'ISO start from open_times' },
  }, ['type', 'start']), [CLIENT, ENGINEER]),
  tool('cancel_call', 'Cancel a booked call by its id.', schema({
    accountId: ACCOUNT,
    meetingId: { type: 'string' },
  }, ['meetingId']), [CLIENT, ENGINEER]),
  tool('list_approvals', 'Drafts waiting for a person at the office.', schema({ accountId: ACCOUNT }), [CLIENT, ENGINEER]),
  tool('decide_approval', 'Approve or decline a draft. Only when the person asked for that decision.', schema({
    accountId: ACCOUNT,
    id: { type: 'string' },
    decision: { type: 'string', enum: ['approved', 'declined'] },
  }, ['id', 'decision']), [CLIENT, ENGINEER]),
  tool('list_requests', 'Changes the office has asked for.', schema({ accountId: ACCOUNT }), [CLIENT, ENGINEER]),
  tool('send_request', 'Ask the studio for a change. The studio answers on weekdays.', schema({
    accountId: ACCOUNT,
    summary: { type: 'string' },
  }, ['summary']), [CLIENT, ENGINEER]),
  tool('close_request', 'Mark a request done. Engineer only.', schema({
    accountId: ACCOUNT,
    id: { type: 'string' },
  }, ['id']), [ENGINEER]),
];

function tool(name, description, inputSchema, roles) {
  return { name, description, inputSchema, roles };
}

function publicTools(role) {
  return TOOLS.filter((item) => item.roles.includes(role)).map((item) => ({
    name: item.name,
    description: item.description,
    inputSchema: item.inputSchema,
  }));
}

function text(t, isError) {
  return { content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) };
}

function priceLine(status) {
  if (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'unpaid') return '$1,000 a month';
  return '$6,000 to start, then $1,000 a month';
}

async function officeId(ctx, args) {
  const passed = args && typeof args.accountId === 'string' ? args.accountId.trim() : '';
  if (ctx.role === CLIENT) {
    if (passed && passed !== ctx.accountId) throw fail(403, 'This connection is for one office.');
    if (!ctx.accountId) throw fail(403, 'This connection is not attached to an office.');
    return ctx.accountId;
  }
  if (!passed) throw fail(400, 'accountId is required.');
  const account = await store.accountById(passed);
  if (!account) throw fail(404, 'That account is not here.');
  return passed;
}

async function officeRecord(ctx, args) {
  const id = await officeId(ctx, args);
  const account = await store.accountById(id);
  if (!account) throw fail(404, 'That account is not here.');
  return account;
}

function lines(rows) {
  return rows.filter(Boolean).join('\n');
}

async function callTool(ctx, name, args) {
  const known = TOOLS.find((item) => item.name === name);
  if (!known || !known.roles.includes(ctx.role)) return text('That tool is not on this connection.', true);
  const input = args || {};
  try {
    if (name === 'whoami') {
      if (ctx.role === ENGINEER) {
        return text(lines([
          'Engineer.',
          ctx.name || ctx.email,
          ctx.email,
          'This connection can open every office. It cannot charge a card or invite another engineer.',
        ]));
      }
      const account = await store.accountById(ctx.accountId);
      return text(lines([
        'Client.',
        (account && account.office) || 'Office',
        ctx.email,
        'This connection is only this office. It cannot charge a card.',
      ]));
    }
    if (name === 'list_accounts') {
      const accounts = await store.listAccounts();
      if (!accounts.length) return text('No offices yet.');
      return text(accounts.map((account) => lines([
        account.office + ' · ' + account.id,
        account.kind + '. ' + (account.status || 'invited') + '. Billing ' + (account.billingStatus || 'none') + '.',
      ])).join('\n\n'));
    }
    if (name === 'list_leads') {
      const leads = await store.listLeads();
      if (!leads.length) return text('No leads yet.');
      return text(leads.map((lead) => lines([
        (lead.name || lead.email || 'Lead') + (lead.email ? ' · ' + lead.email : ''),
        [lead.business, lead.chore || lead.intent, lead.source].filter(Boolean).join('. '),
      ])).join('\n\n'));
    }
    if (name === 'create_account') {
      const { errors, clean } = validateAccountCreate(input);
      if (errors.length) return text(errors.join('\n'), true);
      const account = await store.createAccount(clean);
      const link = siteUrl() + '/portal/login/?email=' + encodeURIComponent(clean.email);
      let mailed = true;
      try {
        await sendMail({
          to: clean.email,
          replyTo: ROGER,
          subject: 'Your Algorithmacy Studio account',
          text: 'An account is open for ' + clean.office + '.\n\nSign in: ' + link + '\n\nNothing is connected until the access is agreed.',
          html: '<p>An account is open for ' + escapeHtml(clean.office) + '.</p><p><a href="' + escapeHtml(link) + '">Sign in</a></p>',
        });
      } catch (e) {
        mailed = false;
        console.error('studio mcp account email', e);
      }
      return text(lines([
        'Opened ' + account.office + ' · ' + account.id,
        mailed ? 'A sign-in link was emailed to ' + clean.email + '.' : 'The account is open, but the sign-in email did not send. Send the link from the portal.',
      ]));
    }
    if (name === 'create_agent') {
      const id = await officeId(ctx, input);
      const { errors, clean } = validateAgent(input);
      if (errors.length) return text(errors.join('\n'), true);
      const agent = await store.createAgent(id, clean);
      return text(agentKeyMessage(agent.name, agent.id));
    }
    if (name === 'set_agent_status') {
      const id = await officeId(ctx, input);
      await store.setAgentStatus(id, String(input.agentId || ''), input.status);
      return text('Marked ' + input.agentId + ' ' + input.status + '.');
    }
    if (name === 'post_report') {
      const id = await officeId(ctx, input);
      const { errors, clean } = validateEvent(input);
      if (errors.length) return text(errors.join('\n'), true);
      const row = await store.addActivity(id, clean);
      return text('Posted. ' + row.id + (row.approvalId ? '. An approval is open: ' + row.approvalId : ''));
    }
    if (name === 'list_agents') {
      const id = await officeId(ctx, input);
      const agents = await store.listAgents(id);
      if (!agents.length) return text('No agents yet.');
      return text(agents.map((agent) => agent.name + ' · ' + agent.id + ' · ' + agent.status + '\n' + agent.chore).join('\n\n'));
    }
    if (name === 'list_reports') {
      const id = await officeId(ctx, input);
      const rows = await store.listActivity(id, { limit: 15 });
      if (!rows.length) return text('No reports yet.');
      return text(rows.map((row) => row.ts + ' · ' + row.type + (row.agentId ? ' · ' + row.agentId : '') + '\n' + row.summary).join('\n\n'));
    }
    if (name === 'subscription') {
      const account = await officeRecord(ctx, input);
      return text(lines([
        account.office,
        'Status: ' + (account.billingStatus || 'none'),
        'Price: ' + priceLine(account.billingStatus || 'none'),
        'Payment stays in the portal. This connection cannot charge a card.',
        siteUrl() + '/portal/billing/',
      ]));
    }
    if (name === 'list_meetings') {
      const id = await officeId(ctx, input);
      const meetings = await booking.listAccountMeetings(id);
      if (!meetings.length) return text('No calls booked.');
      return text(meetings.map((meeting) => meeting.start + ' · ' + meeting.type + ' · ' + meeting.status + ' · ' + meeting.id).join('\n'));
    }
    if (name === 'open_times') {
      const type = input.type === 'monthly' ? 'monthly' : (input.type === 'checkpoint' ? 'checkpoint' : '');
      if (!type) return text('Choose checkpoint or monthly.', true);
      await officeId(ctx, input);
      const slots = await booking.openSlots(type);
      const list = (slots.slots || []).slice(0, 8);
      if (!list.length) return text('No open times in the next two weeks.');
      return text('Times are in ' + slots.timeZone + '.\n' + list.map((slot) => slot.start).join('\n'));
    }
    if (name === 'book_call') {
      const account = await officeRecord(ctx, input);
      const type = input.type === 'monthly' ? 'monthly' : (input.type === 'checkpoint' ? 'checkpoint' : '');
      if (!type) return text('Choose checkpoint or monthly.', true);
      const held = await booking.holdSlot({ type, start: input.start });
      const meeting = await booking.createMeeting({
        type,
        start: input.start,
        name: ctx.name || ctx.email,
        email: ctx.email,
        business: account.office,
        note: '',
        accountId: account.id,
        holdToken: held.holdToken,
      });
      return text('Booked ' + (meeting.start || input.start) + ' · ' + meeting.id);
    }
    if (name === 'cancel_call') {
      const id = await officeId(ctx, input);
      const meeting = await booking.meetingByToken(input.meetingId);
      if (meeting.accountId !== id) throw fail(403, 'That call is not on this office.');
      const cancelled = await booking.cancelMeeting(meeting);
      return text('Cancelled ' + (cancelled.start || meeting.id) + '.');
    }
    if (name === 'list_approvals') {
      const id = await officeId(ctx, input);
      const rows = await store.listApprovals(id, 'pending');
      if (!rows.length) return text('Nothing is waiting for approval.');
      return text(rows.map((row) => row.id + '\n' + (row.summary || '')).join('\n\n'));
    }
    if (name === 'decide_approval') {
      const id = await officeId(ctx, input);
      const result = await store.decideApproval(id, String(input.id || ''), input.decision, ctx.email);
      return text(result.status + '. ' + result.id);
    }
    if (name === 'list_requests') {
      const id = await officeId(ctx, input);
      const rows = await store.listRequests(id);
      if (!rows.length) return text('No requests yet.');
      return text(rows.map((row) => row.createdAt + ' · ' + row.status + ' · ' + row.id + '\n' + row.summary).join('\n\n'));
    }
    if (name === 'send_request') {
      const id = await officeId(ctx, input);
      const { errors, clean } = validateRequest(input);
      if (errors.length) return text(errors.join('\n'), true);
      const row = await store.addRequest(id, { summary: clean.summary, email: ctx.email });
      return text('Sent. ' + row.id);
    }
    if (name === 'close_request') {
      const id = await officeId(ctx, input);
      await store.closeRequest(id, String(input.id || ''));
      return text('Marked done. ' + input.id);
    }
    return text('That tool is not on this connection.', true);
  } catch (e) {
    const message = e && e.status && e.status < 500 ? e.message : 'Something went wrong.';
    if (!e || !e.status || e.status >= 500) console.error('studio mcp tool', name, e);
    return text(message, true);
  }
}

function instructions(role) {
  if (role === ENGINEER) {
    return 'You are connected to Algorithmacy Studio as an engineer. You can open offices, set up agents, post the report the office reads, and book calls. You cannot charge a card or invite another engineer. Do not put a key, a client document, or a transcript into a pull request or a prompt.';
  }
  return 'You are connected to one Algorithmacy Studio office. You can read the agents and reports, see the subscription, book a call, and send a request. You cannot charge a card or open another office. Payment stays in the portal.';
}

async function handleRpc(ctx, msg) {
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
        instructions: instructions(ctx.role),
      });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: publicTools(ctx.role) });
    if (method === 'tools/call') {
      if (!params || typeof params.name !== 'string') {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params: name required' } };
      }
      return reply(id, await callTool(ctx, params.name, params.arguments || {}));
    }
    if (isNotification) return null;
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } };
  } catch (e) {
    console.error('studio mcp rpc', method, e);
    if (isNotification) return null;
    return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } };
  }
}

function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function agentKeyMessage(name, id) {
  return lines([
    'Created ' + name + ' · ' + id,
    'The key is on the account page for 15 minutes. It is shown once there. Do not put it in a prompt or a repository.',
  ]);
}

module.exports = {
  SERVER_INFO,
  publicTools,
  callTool,
  handleRpc,
  instructions,
  agentKeyMessage,
};
