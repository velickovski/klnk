import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { apiPath, enlargeTextAndSpacing, expectNoCapture, installNoCaptureProbe } from './helpers';
import {
  guardContext,
  registerNetwork,
  networkCall,
  connectMembers,
  separateContext,
  seedRule,
  meetingInput,
  expectNoNetworkOverflow,
} from './network-helpers';

test.beforeEach(async ({ context, page }, info) => {
  await context.setExtraHTTPHeaders({ 'x-klnk-test-client': info.testId });
  await guardContext(context);
  await installNoCaptureProbe(page);
});

test('M3 default Call entry, keyed sharing, real history and stable virtualized-form focus at narrow large text', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const account = await registerNetwork(page, 'Fictional default owner', 'call');
  await expect(page.getByRole('heading', { name: 'Make klnk yours', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Inbox', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Calendar', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'People', exact: true })).toBeFocused();
  const connections: string[] = [];
  page.on('request', (r) => {
    if (r.url() === apiPath('/network/connections') && r.method() === 'GET')
      connections.push(r.url());
  });
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/people$/);
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await expect(page.getByText('Your context starts with you', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add network memory', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Memory text', exact: true });
  await field.focus();
  await field.pressSequentially('A persistent fictional draft');
  await expect(field).toBeFocused();
  await mkdir('docs/review/2026-10-28/evidence', { recursive: true });
  await page.screenshot({ path: 'docs/review/2026-10-28/evidence/m3-narrow-memory-draft.png' });
  await enlargeTextAndSpacing(page);
  await expectNoNetworkOverflow(page);
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/workspace\/memory$/);
  await expect(field).toHaveValue('A persistent fictional draft');
  await field.focus();
  await field.pressSequentially(' still focused');
  await expect(field).toBeFocused();
  expect(connections.length).toBeLessThanOrEqual(1);
  expect((await networkCall(context, account, '/network/policy')).enabled).toBe(false);
  await page.getByRole('tab', { name: 'Inbox', exact: true }).click();
  await page.getByRole('button', { name: 'Back to voice home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Call klnk', exact: true })).toBeVisible();
  await expectNoCapture(page);
});

test('M3 a long Memory collection renders in bounded batches and scrolls to the final real row at 200% text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const account = await registerNetwork(page, 'Fictional collection owner', 'call'),
    now = new Date().toISOString();
  const memories = Array.from({ length: 80 }, (_, index) => ({
    id: randomUUID(),
    ownerId: account.user.id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    text: `Fictional collection record ${index + 1}`,
    topic: `Collection topic ${index + 1}`,
    sharing: 'private',
    memberIds: [],
    confirmed: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    source: 'owner',
  }));
  await page.route(apiPath('/network/memories'), (r) => r.fulfill({ json: { memories } }));
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await expect(page.getByText('Fictional collection record 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Fictional collection record 80', { exact: true })).toHaveCount(0);
  const list = page.getByTestId('network-memory');
  await expect
    .poll(
      async () => {
        await enlargeTextAndSpacing(page);
        // RN Web decorates its host scrollTo with native {x,y} options.
        // The browser scrollTop setter exercises actual DOM scrolling.
        await list.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        return page.getByText('Fictional collection record 80', { exact: true }).isVisible();
      },
      { intervals: [100, 200, 250] },
    )
    .toBe(true);
  // The final batch may have mounted after the poll's last scaling pass.
  await enlargeTextAndSpacing(page);
  await page.getByText('Fictional collection record 80', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('Fictional collection record 80', { exact: true })).toBeInViewport();
  const finalFont = await page
    .getByText('Fictional collection record 80', { exact: true })
    .evaluate((element) => ({
      actual: parseFloat(getComputedStyle(element).fontSize),
      base: Number((element as HTMLElement).dataset.klnkQaBaseFont),
    }));
  expect(finalFont.base).toBeGreaterThan(0);
  expect(finalFont.actual).toBeCloseTo(finalFont.base * 2, 1);
  const navigationBounds = await page.getByTestId('network-navigation').boundingBox();
  const contentBounds = await page.getByTestId('network-screen-memory').boundingBox();
  expect(navigationBounds?.height).toBeLessThan(140);
  expect(contentBounds?.height).toBeGreaterThan(280);
  await mkdir('docs/review/2026-10-28/evidence', { recursive: true });
  await page.screenshot({ path: 'docs/review/2026-10-28/evidence/m3-long-memory-large-text.png' });
  await expectNoNetworkOverflow(page);
  await expectNoCapture(page);
});

test('M3 recipient answers a manual question and sends a new meeting time through actual dialogs', async ({
  browser,
}, info) => {
  const a = await separateContext(browser, info),
    b = await separateContext(browser, info);
  try {
    const alice = {
        ...a,
        account: await registerNetwork(a.page, 'Fictional asking owner', 'call'),
      },
      jordan = {
        ...b,
        account: await registerNetwork(b.page, 'Fictional answering owner', 'call'),
      };
    const connection = await connectMembers(alice, jordan);
    const question = await networkCall(a.context, alice.account, '/network/conversations', 'POST', {
      ...meetingInput(connection.id, 'Fictional entrance question'),
      kind: 'ask',
      candidateSlots: [],
      message: 'Which fictional entrance should I use?',
    });
    await b.page.getByRole('tab', { name: 'Inbox', exact: true }).click();
    await b.page.getByRole('button', { name: 'Refresh Inbox', exact: true }).click();
    await expect(
      b.page.getByRole('button', {
        name: 'Open request: Fictional entrance question',
        exact: true,
      }),
    ).toBeVisible();
    const questionCard = b.page.getByRole('button', {
      name: 'Open request: Fictional entrance question',
      exact: true,
    });
    await questionCard.click();
    await expect(b.page.getByRole('dialog')).toBeVisible();
    await b.page
      .getByRole('textbox', { name: 'Your exact reply', exact: true })
      .fill('Use the fictional west entrance.');
    await b.page.getByRole('button', { name: 'Send this exact reply', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await networkCall(a.context, alice.account, `/network/conversations/${question.id}`))
            .state,
      )
      .toBe('answered');
    await b.page.getByRole('button', { name: 'Close conversation details', exact: true }).click();
    await expect(questionCard).toBeFocused();
    await questionCard.press('Enter');
    await expect(b.page.getByRole('dialog')).toBeVisible();
    await b.page.keyboard.press('Escape');
    await expect(b.page.getByRole('dialog')).toHaveCount(0);
    await expect(questionCard).toBeFocused();
    await seedRule(a.context, alice.account, jordan.account, { autoAcceptMeetings: false });
    await seedRule(b.context, jordan.account, alice.account, { autoAcceptMeetings: false });
    const request = meetingInput(connection.id, 'Fictional alternative meeting'),
      meeting = await networkCall(
        a.context,
        alice.account,
        '/network/conversations',
        'POST',
        request,
      );
    await expect
      .poll(
        async () =>
          (await networkCall(b.context, jordan.account, `/network/conversations/${meeting.id}`))
            .state,
      )
      .toBe('awaiting_approval');
    await b.page.getByRole('button', { name: 'Refresh Inbox', exact: true }).click();
    await b.page
      .getByRole('button', { name: 'Open request: Fictional alternative meeting', exact: true })
      .click();
    await b.page.getByRole('button', { name: 'Suggest another meeting time', exact: true }).click();
    const alternative = new Date(Date.parse(request.candidateSlots[0].startAt) + 3600000),
      end = new Date(+alternative + 1800000);
    await b.page
      .getByLabel('Alternative starts at', { exact: true })
      .fill(alternative.toISOString().slice(0, 16));
    await b.page
      .getByLabel('Alternative ends at', { exact: true })
      .fill(end.toISOString().slice(0, 16));
    await b.page.getByRole('button', { name: 'Send this counterproposal', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await networkCall(a.context, alice.account, `/network/conversations/${meeting.id}`))
            .proposal?.version,
      )
      .toBe(2);
    const current = await networkCall(
      a.context,
      alice.account,
      `/network/conversations/${meeting.id}`,
    );
    expect(current.proposal.terms.slot.startAt).toBe(alternative.toISOString());
    expect(current.decisionOwnerIds).toEqual([alice.account.user.id]);
    await expectNoCapture(a.page);
    await expectNoCapture(b.page);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('M3 a shared join URL prefills a member and never sends or accepts an invitation automatically', async ({
  browser,
}, info) => {
  const a = await separateContext(browser, info),
    b = await separateContext(browser, info);
  try {
    const alice = await registerNetwork(a.page, 'Fictional link opener', 'call'),
      jordan = await registerNetwork(b.page, 'Fictional link owner', 'call');
    const identity = await networkCall(b.context, jordan, '/network/identity');
    let writes = 0;
    a.page.on('request', (request) => {
      if (request.url() === apiPath('/network/connections') && request.method() === 'POST')
        writes++;
    });
    await a.page.goto(`/join/${identity.member.memberCode}`);
    // Browser bearer sessions stay in memory. Opening a link in a fresh page
    // requires explicit sign-in; its path must survive that account entry.
    await a.page.getByRole('textbox', { name: 'Email', exact: true }).fill(alice.email);
    await a.page.getByRole('textbox', { name: 'Password', exact: true }).fill(alice.password);
    await a.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(a.page.getByRole('textbox', { name: 'Member code', exact: true })).toHaveValue(
      identity.member.memberCode,
    );
    expect(writes).toBe(0);
    expect((await networkCall(a.context, alice, '/network/connections')).connections).toEqual([]);
    await a.page.getByRole('button', { name: 'Request connection', exact: true }).click();
    await expect(a.page.getByText('Awaiting their acceptance', { exact: true })).toBeVisible();
    expect(writes).toBe(1);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
