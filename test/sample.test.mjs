import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_ID, bindSampleUser, resetSample, sampleAccount, sampleApi } from '../assets/js/portal/sample.js';

test('the sample office has a full client record', async () => {
  resetSample();
  bindSampleUser('regorhunt02052@gmail.com', 'Roger Hunt');
  const account = sampleAccount();
  assert.equal(account.id, SAMPLE_ID);
  assert.equal(account.office, 'Harbor & Finch');
  assert.equal(account.role, 'owner');
  assert.equal(account.members[0].name, 'Ada Finch');
  assert.equal(account.members[0].role, 'owner');
  assert.ok(!account.members.some((member) => member.email === 'regorhunt02052@gmail.com'));

  const home = await sampleApi('home');
  assert.ok(home.agents.length >= 3);
  assert.ok(home.upcoming);
  assert.ok(home.approvals.length >= 1);
  assert.ok(home.requests.length >= 1);

  const activity = await sampleApi('activity?type=blocked&agent=chase');
  assert.equal(activity.activity.length, 1);
  assert.match(activity.activity[0].summary, /Morales/);

  const pending = home.approvals[0];
  await sampleApi('approvals', { method: 'POST', body: { id: pending.id, decision: 'approved' } });
  const after = await sampleApi('approvals');
  assert.ok(after.approvals.every((item) => item.id !== pending.id));

  await sampleApi('requests', { method: 'POST', body: { summary: 'Pause Chase next week.' } });
  const requests = await sampleApi('requests');
  assert.equal(requests.requests[0].summary, 'Pause Chase next week.');

  const checkpoint = await sampleApi('meetings/slots?type=checkpoint');
  assert.equal(checkpoint.slots.length, 0);
  assert.match(checkpoint.closed, /checkpoint/i);
  const slots = await sampleApi('meetings/slots?type=monthly');
  assert.ok(slots.slots.length >= 4);
  const held = await sampleApi('meetings/hold', { method: 'POST', body: { type: 'checkpoint', start: slots.slots[0].start } });
  await sampleApi('meetings', { method: 'POST', body: { type: 'checkpoint', start: slots.slots[0].start, holdToken: held.holdToken } });
  const meetings = await sampleApi('meetings');
  assert.equal(meetings.meetings[0].start, slots.slots[0].start);

  const reports = await sampleApi('reports');
  assert.ok(reports.reports.length >= 2);

  await sampleApi('billing/checkout', { method: 'POST', body: {} });
  assert.equal(sampleAccount().billingStatus, 'active');
  const stripe = await sampleApi('billing/portal', { method: 'POST', body: {} });
  assert.equal(stripe.notice.includes('Stripe'), true);
  assert.equal(stripe.url, undefined);

  resetSample();
  assert.equal(sampleAccount().billingStatus, 'none');
  assert.equal(sampleAccount().members[0].name, 'Ada Finch');
  assert.ok(!sampleAccount().members.some((member) => member.email === 'regorhunt02052@gmail.com'));
});

test('the portal script loads', async () => {
  globalThis.document = {
    getElementById() { return null; },
    addEventListener() {},
  };
  await import('../assets/js/portal/app.js');
});
