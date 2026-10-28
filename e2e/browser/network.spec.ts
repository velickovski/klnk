import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { apiPath, enlargeTextAndSpacing, expectNoCapture, installNoCaptureProbe } from './helpers';
import {
  connectMembers,
  egressProbes,
  expectNoNetworkOverflow,
  guardContext,
  loginNetwork,
  meetingInput,
  networkCall,
  registerNetwork,
  seedRule,
  separateContext,
} from './network-helpers';

test.beforeEach(async ({ context, page }, testInfo) => {
  egressProbes.length = 0;
  await context.setExtraHTTPHeaders({ 'x-klnk-test-client': testInfo.testId });
  await guardContext(context);
  await installNoCaptureProbe(page);
});
test.afterEach(async ({}, testInfo) => {
  await testInfo.attach('network-egress-observations', {
    body: JSON.stringify({
      contexts: egressProbes.length,
      blockedNonlocalAttempts: egressProbes.reduce((n, p) => n + p.external, 0),
    }),
    contentType: 'application/json',
  });
  expect(egressProbes.map((p) => p.external)).toEqual(egressProbes.map(() => 0));
});

test('NETWORK opening keeps exactly one Call klnk action and loaded bytes match the exported source', async ({
  page,
  browser,
}, testInfo) => {
  const loaded = page.waitForResponse((r) =>
    /^\/_expo\/static\/js\/web\/index-[a-f0-9]+\.js$/.test(new URL(r.url()).pathname),
  );
  await page.goto('/');
  const response = await loaded,
    path = new URL(response.url()).pathname;
  const served = createHash('sha256')
      .update(await response.body())
      .digest('hex'),
    exported = createHash('sha256')
      .update(await readFile(resolve('apps/mobile/dist-e2e', '.' + path)))
      .digest('hex');
  expect(served).toBe(exported);
  await testInfo.attach('network-served-source-identity', {
    body: JSON.stringify({
      path,
      servedSha256: served,
      exportedSha256: exported,
      browserVersion: browser.version(),
    }),
    contentType: 'application/json',
  });
  await expect(page.getByRole('button')).toHaveCount(1);
  const call = page.getByRole('button', { name: 'Call klnk', exact: true });
  await page.keyboard.press('Tab');
  await expect(call).toBeFocused();
  await expectNoCapture(page);
});

test('NETWORK two separate authenticated owners coordinate while Jordan is offline; returning owner sees truthful summary/event/reminder', async ({
  browser,
}, testInfo) => {
  const a = await separateContext(browser, testInfo),
    b = await separateContext(browser, testInfo);
  let returned: Awaited<ReturnType<typeof separateContext>> | undefined;
  try {
    const alice = { ...a, account: await registerNetwork(a.page, 'Fictional Alice') },
      jordan = { ...b, account: await registerNetwork(b.page, 'Fictional Jordan') };
    const connection = await connectMembers(alice, jordan);
    expect((await networkCall(a.context, alice.account, '/network/policy')).enabled).toBe(false);
    expect((await networkCall(b.context, jordan.account, '/network/policy')).enabled).toBe(false);
    await seedRule(a.context, alice.account, jordan.account);
    await seedRule(b.context, jordan.account, alice.account);
    await b.context.close();
    const input = meetingInput(connection.id);
    await a.page.getByRole('tab', { name: 'Inbox', exact: true }).click();
    await a.page.getByRole('button', { name: 'Refresh Inbox', exact: true }).click();
    await a.page.getByRole('button', { name: 'Write an internal request', exact: true }).click();
    await a.page.getByRole('radio', { name: 'Fictional Jordan', exact: true }).click();
    await a.page.getByRole('radio', { name: 'Coordinate a meeting', exact: true }).click();
    await a.page
      .getByRole('textbox', { name: 'Exact delegated purpose', exact: true })
      .fill(input.purpose);
    await a.page.getByRole('textbox', { name: 'Request topic', exact: true }).fill(input.topic);
    await a.page
      .getByRole('textbox', { name: 'Exact message and permitted details', exact: true })
      .fill(input.message);
    await a.page.getByRole('button', { name: 'Add candidate time', exact: true }).click();
    await a.page
      .getByRole('textbox', { name: 'Candidate 1 starts at', exact: true })
      .fill(input.candidateSlots[0].startAt);
    await a.page
      .getByRole('textbox', { name: 'Candidate 1 ends at', exact: true })
      .fill(input.candidateSlots[0].endAt);
    await a.page.getByRole('textbox', { name: 'Candidate 1 timezone', exact: true }).fill('UTC');
    await a.page
      .getByRole('textbox', { name: 'Meeting location', exact: true })
      .fill(input.location);
    await a.page
      .getByRole('textbox', { name: 'Request expires at', exact: true })
      .fill(input.expiresAt);
    await a.page.getByRole('button', { name: 'Send internal request', exact: true }).click();
    await expect
      .poll(async () => {
        const inbox = await networkCall(a.context, alice.account, '/network/conversations');
        return inbox.conversations[0]?.state;
      })
      .toBe('agreed');
    const shared = (await networkCall(a.context, alice.account, '/network/conversations'))
      .conversations[0];
    expect(shared.readBy).not.toContain(jordan.account.user.id);
    expect(
      shared.acceptances.every(
        (r: any) =>
          r.proposalHash === shared.proposal.hash && r.proposalVersion === shared.proposal.version,
      ),
    ).toBe(true);
    returned = await separateContext(browser, testInfo);
    await loginNetwork(returned.page, jordan.account);
    await returned.page
      .getByRole('button', { name: `Open request: ${input.purpose}`, exact: true })
      .click();
    await expect(
      returned.page.getByText(/agent accepted under that owner’s delegation rules/),
    ).toBeVisible();
    await expect(
      returned.page.getByText('Unread by you · Reading is separate from approval.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      returned.page.getByText('Internal calendar event recorded', { exact: true }),
    ).toBeVisible();
    await mkdir(resolve('docs/agent-network/evidence'), { recursive: true });
    await returned.page.screenshot({
      path: resolve('docs/agent-network/evidence/two-owner-return-summary.png'),
    });
    await returned.page
      .getByRole('button', { name: 'Open the internal calendar', exact: true })
      .click();
    await expect(
      returned.page.getByRole('button', {
        name: `Dismiss my reminder: ${input.purpose}`,
        exact: true,
      }),
    ).toBeVisible();
    const calendar = await networkCall(returned.context, jordan.account, '/network/calendar');
    expect(calendar.events).toHaveLength(1);
    expect(calendar.reminders).toHaveLength(1);
    expect(calendar.reminders[0].ownerId).toBe(jordan.account.user.id);
    await returned.page.screenshot({
      path: resolve('docs/agent-network/evidence/two-owner-return-calendar.png'),
    });
    await expectNoCapture(a.page);
    await expectNoCapture(returned.page);
  } finally {
    await a.context.close();
    await b.context.close();
    await returned?.context.close();
  }
});

test('NETWORK only Jordan can approve exact terms; UI reading is distinct from owner approval', async ({
  browser,
}, testInfo) => {
  const a = await separateContext(browser, testInfo),
    b = await separateContext(browser, testInfo);
  try {
    const alice = { ...a, account: await registerNetwork(a.page, 'Approval Alice') },
      jordan = { ...b, account: await registerNetwork(b.page, 'Approval Jordan') };
    const connection = await connectMembers(alice, jordan);
    await seedRule(a.context, alice.account, jordan.account);
    await seedRule(b.context, jordan.account, alice.account, { autoAcceptMeetings: false });
    const input = meetingInput(connection.id, 'Fictional approval meeting');
    const created = await networkCall(
      a.context,
      alice.account,
      '/network/conversations',
      'POST',
      input,
    );
    await expect
      .poll(
        async () =>
          (await networkCall(a.context, alice.account, `/network/conversations/${created.id}`))
            .state,
      )
      .toBe('awaiting_approval');
    for (const owner of [alice, jordan]) {
      await owner.page.getByRole('tab', { name: 'Inbox', exact: true }).click();
      await owner.page.getByRole('button', { name: 'Refresh Inbox', exact: true }).click();
      await owner.page
        .getByRole('button', { name: `Open request: ${input.purpose}`, exact: true })
        .click();
    }
    await expect(
      a.page.getByRole('button', { name: 'Approve this exact meeting proposal', exact: true }),
    ).toHaveCount(0);
    await expect(
      a.page.getByText(
        'The other owner’s decision is needed. You cannot approve on their behalf.',
        { exact: true },
      ),
    ).toBeVisible();
    await b.page.getByRole('button', { name: 'Mark this conversation read', exact: true }).click();
    expect((await networkCall(b.context, jordan.account, '/network/calendar')).events).toEqual([]);
    await b.page
      .getByRole('button', { name: 'Approve this exact meeting proposal', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await networkCall(b.context, jordan.account, `/network/conversations/${created.id}`))
            .state,
      )
      .toBe('agreed');
    await b.page.getByRole('button', { name: 'Refresh Inbox', exact: true }).click();
    await expect(b.page.getByText(/owner explicitly approved this proposal/)).toBeVisible();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('NETWORK failed memory save retains typed draft; navigation preserves it and signout clears private owner state', async ({
  page,
  context,
}) => {
  const alice = await registerNetwork(page, 'Private Alice');
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await page.getByRole('button', { name: 'Add network memory', exact: true }).click();
  const text = page.getByRole('textbox', { name: 'Memory text', exact: true });
  await text.fill('FICTIONAL PRIVATE OWNER A DRAFT');
  await page.getByRole('textbox', { name: 'Memory topic', exact: true }).fill('routine');
  await expect(page.getByRole('radio', { name: 'Private to me', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Needs my review', exact: true })).toBeChecked();
  await page.route(apiPath('/network/memories'), async (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 503,
          json: { error: 'qa_offline', message: 'Fictional network memory offline.' },
        })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Save network memory', exact: true }).click();
  await expect(page.getByText(/Fictional network memory offline/)).toBeVisible();
  await expect(text).toHaveValue('FICTIONAL PRIVATE OWNER A DRAFT');
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await expect(text).toHaveValue('FICTIONAL PRIVATE OWNER A DRAFT');
  await page.unroute(apiPath('/network/memories'));
  await page.getByRole('button', { name: 'Save network memory', exact: true }).click();
  await expect(page.getByText('FICTIONAL PRIVATE OWNER A DRAFT', { exact: true })).toBeVisible();
  expect((await networkCall(context, alice, '/network/memories')).memories).toHaveLength(1);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await registerNetwork(page, 'Private Bob');
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await expect(page.getByText('Your context starts with you', { exact: true })).toBeVisible();
  await expect(page.getByText('FICTIONAL PRIVATE OWNER A DRAFT', { exact: true })).toHaveCount(0);
  await expectNoCapture(page);
});

test('NETWORK freeform exact Tell recovers a lost response using the same command; unavailable planning keeps a typed route', async ({
  browser,
}, testInfo) => {
  const a = await separateContext(browser, testInfo),
    b = await separateContext(browser, testInfo);
  try {
    const alice = { ...a, account: await registerNetwork(a.page, 'Freeform Alice') },
      jordan = { ...b, account: await registerNetwork(b.page, 'Jordan Lee') };
    await connectMembers(alice, jordan);
    await seedRule(a.context, alice.account, jordan.account);
    await seedRule(b.context, jordan.account, alice.account);
    await a.page.getByRole('tab', { name: 'Inbox', exact: true }).click();
    let posts = 0,
      commandId = '';
    a.page.on('request', (request) => {
      if (request.url() === apiPath('/network/owner-intents') && request.method() === 'POST')
        posts++;
    });
    await a.page.route(apiPath('/network/owner-intents'), async (route) => {
      const payload = route.request().postDataJSON();
      commandId = payload.commandId;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('connectionfailed');
    });
    const instruction = a.page.getByRole('textbox', {
      name: 'Instruction to your agent',
      exact: true,
    });
    await instruction.fill('Tell Jordan Lee that I am at the fictional blue gate.');
    await a.page.getByRole('button', { name: 'Send to my agent', exact: true }).click();
    await expect(a.page.getByText(/The response is unconfirmed/)).toBeVisible();
    await expect(instruction).toHaveValue('Tell Jordan Lee that I am at the fictional blue gate.');
    await expect(instruction).not.toBeEditable();
    await expect(a.page.getByRole('button', { name: 'Send to my agent', exact: true })).toHaveCount(
      0,
    );
    await a.page.unroute(apiPath('/network/owner-intents'));
    const readback = a.page.waitForResponse(
      (r) =>
        r.url() === apiPath(`/network/owner-intents/${commandId}`) &&
        r.request().method() === 'GET',
    );
    await a.page.getByRole('button', { name: 'Check this instruction', exact: true }).click();
    expect((await readback).status()).toBe(200);
    await expect(a.page.getByText(/^Recorded ·/)).toBeVisible();
    expect(posts).toBe(1);
    await expect
      .poll(async () => {
        const inbox = await networkCall(a.context, alice.account, '/network/conversations');
        return inbox.conversations[0]?.state;
      })
      .toBe('delivered');
    const inbox = await networkCall(a.context, alice.account, '/network/conversations');
    expect(inbox.conversations).toHaveLength(1);
    expect(inbox.conversations[0].request.message).toBe('I am at the fictional blue gate.');
    expect(inbox.conversations[0].request.requestId).toBe(commandId);
    expect((await networkCall(a.context, alice.account, '/network/calendar')).events).toEqual([]);
    await a.page.getByRole('button', { name: 'Give another instruction', exact: true }).click();
    await instruction.fill('Arrange thirty minutes with Jordan Lee next week after 2 pm.');
    await a.page.getByRole('button', { name: 'Send to my agent', exact: true }).click();
    await expect(
      a.page.getByText(
        'OpenAI planning is unavailable. Exact messages and structured requests remain available below.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      a.page.getByRole('button', { name: 'Write an internal request', exact: true }),
    ).toBeVisible();
    expect(
      (await networkCall(a.context, alice.account, '/network/conversations')).conversations,
    ).toHaveLength(1);
    await expectNoCapture(a.page);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('NETWORK delayed old-owner private memory response cannot populate a newly signed-in owner', async ({
  page,
  context,
}) => {
  const alice = await registerNetwork(page, 'Delayed Alice');
  await networkCall(context, alice, '/network/memories', 'POST', {
    text: 'FICTIONAL DELAYED PRIVATE A',
    topic: 'routine',
    sharing: 'private',
    memberIds: [],
    confirmed: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  let release!: () => void, captured!: () => void, finished!: () => void;
  const waiting = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      captured = r;
    }),
    done = new Promise<void>((r) => {
      finished = r;
    });
  let held = false;
  await page.route(apiPath('/network/memories'), async (route) => {
    if (held || route.request().method() !== 'GET') return route.fallback();
    held = true;
    const response = await route.fetch(),
      body = await response.body();
    captured();
    await waiting;
    try {
      await route.fulfill({ response, body });
    } catch {
      /* Epoch cancellation may already have aborted the old request. */
    } finally {
      finished();
    }
  });
  try {
    await page.getByRole('button', { name: 'Refresh Memory', exact: true }).click();
    await ready;
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await registerNetwork(page, 'Delayed Bob');
    release();
    await done;
    await page.getByRole('tab', { name: 'Memory', exact: true }).click();
    await expect(page.getByText('Your context starts with you', { exact: true })).toBeVisible();
    await expect(page.getByText('FICTIONAL DELAYED PRIVATE A', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toBeVisible();
  } finally {
    release();
  }
});

test('NETWORK pre-claim instruction failure and 404 readback permit an explicit retry with the exact frozen command', async ({
  browser,
}, testInfo) => {
  const a = await separateContext(browser, testInfo),
    b = await separateContext(browser, testInfo);
  try {
    const alice = { ...a, account: await registerNetwork(a.page, 'Retry Alice') },
      jordan = { ...b, account: await registerNetwork(b.page, 'Retry Jordan') };
    await connectMembers(alice, jordan);
    await seedRule(a.context, alice.account, jordan.account);
    await seedRule(b.context, jordan.account, alice.account);
    await a.page.getByRole('tab', { name: 'Inbox', exact: true }).click();
    const posts: Array<{ commandId: string; text: string }> = [];
    a.page.on('request', (request) => {
      if (request.url() === apiPath('/network/owner-intents') && request.method() === 'POST')
        posts.push(request.postDataJSON());
    });
    await a.page.route(apiPath('/network/owner-intents'), (route) =>
      route.abort('connectionfailed'),
    );
    const text = 'Tell Retry Jordan that I will use the fictional blue entrance.',
      field = a.page.getByRole('textbox', { name: 'Instruction to your agent', exact: true });
    await field.fill(text);
    await a.page.getByRole('button', { name: 'Send to my agent', exact: true }).click();
    await expect(a.page.getByText(/The response is unconfirmed/)).toBeVisible();
    await expect(field).toHaveValue(text);
    await expect(field).not.toBeEditable();
    expect(posts).toHaveLength(1);
    const frozen = { ...posts[0] };
    await a.page.unroute(apiPath('/network/owner-intents'));
    const read = a.page.waitForResponse(
      (r) => r.url() === apiPath(`/network/owner-intents/${frozen.commandId}`),
    );
    await a.page.getByRole('button', { name: 'Check this instruction', exact: true }).click();
    expect((await read).status()).toBe(404);
    await expect(a.page.getByText(/Readback failed/)).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(
      (await networkCall(a.context, alice.account, '/network/conversations')).conversations,
    ).toEqual([]);
    await expect(field).toHaveValue(text);
    await a.page.getByRole('button', { name: 'Retry this same instruction', exact: true }).click();
    await expect(a.page.getByText(/^Recorded ·/)).toBeVisible();
    expect(posts).toEqual([frozen, frozen]);
    await expect
      .poll(
        async () =>
          (await networkCall(a.context, alice.account, '/network/conversations')).conversations[0]
            ?.state,
      )
      .toBe('delivered');
    const conversations = (await networkCall(a.context, alice.account, '/network/conversations'))
      .conversations;
    expect(conversations).toHaveLength(1);
    expect(conversations[0].request.requestId).toBe(frozen.commandId);
    expect(conversations[0].request.message).toBe('I will use the fictional blue entrance.');
    expect((await networkCall(a.context, alice.account, '/network/calendar')).events).toEqual([]);
    await expectNoCapture(a.page);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

for (const colorScheme of ['light', 'dark'] as const)
  for (const width of [320, 390, 430])
    test(`NETWORK layout ${width}px ${colorScheme}, all panels plus 200 percent text`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto('/');
      await expect(page.getByRole('button')).toHaveCount(1);
      await expectNoNetworkOverflow(page);
      await registerNetwork(page, `Layout ${width} ${colorScheme}`);
      for (const name of ['Inbox', 'Calendar', 'People', 'Memory', 'Settings']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expectNoNetworkOverflow(page);
        if (width === 390) {
          await mkdir(resolve('docs/agent-network/evidence'), { recursive: true });
          await page.screenshot({
            path: resolve(
              'docs/agent-network/evidence/panel-' +
                name.toLowerCase() +
                '-390-' +
                colorScheme +
                '.png',
            ),
          });
        }
      }
      const panelMetrics = [];
      for (const name of ['Inbox', 'Calendar', 'People', 'Memory', 'Settings']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await enlargeTextAndSpacing(page);
        const tabs = page.getByRole('tab');
        await expect(tabs).toHaveCount(5);
        const metrics = await tabs.evaluateAll((elements) =>
          elements.map((element) => {
            const b = element.getBoundingClientRect(),
              range = document.createRange();
            range.selectNodeContents(element);
            const t = range.getBoundingClientRect();
            return {
              name: element.getAttribute('aria-label'),
              width: b.width,
              height: b.height,
              top: b.top,
              bottom: b.bottom,
              textFits:
                t.top >= b.top - 1 &&
                t.bottom <= b.bottom + 1 &&
                t.left >= b.left - 1 &&
                t.right <= b.right + 1,
            };
          }),
        );
        panelMetrics.push({ panel: name, navigation: metrics });
        for (const metric of metrics) {
          expect(metric.width).toBeGreaterThanOrEqual(44);
          expect(metric.height).toBeGreaterThanOrEqual(44);
          expect(metric.top).toBeGreaterThanOrEqual(0);
          expect(metric.bottom).toBeLessThanOrEqual(845);
          expect(metric.textFits).toBe(true);
        }
        await expectNoNetworkOverflow(page);
        if (width === 390)
          await page.screenshot({
            path: resolve(
              'docs/agent-network/evidence/enlarged-panel-' +
                name.toLowerCase() +
                '-390-' +
                colorScheme +
                '.png',
            ),
          });
      }
      await testInfo.attach('network-layout-metrics', {
        body: JSON.stringify({ width, colorScheme, panelMetrics }),
        contentType: 'application/json',
      });
      await page.getByRole('tab', { name: 'Memory', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Add network memory', exact: true }).focus();
      await page.keyboard.press('Enter');
      await enlargeTextAndSpacing(page);
      const field = page.getByRole('textbox', { name: 'Memory text', exact: true });
      expect(
        await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
      ).toBeGreaterThanOrEqual(34);
      await field.focus();
      await page.keyboard.type('Keyboard fictional draft');
      await expect(field).toHaveValue('Keyboard fictional draft');
      await page
        .getByRole('button', { name: 'Discard memory draft', exact: true })
        .scrollIntoViewIfNeeded();
      await expectNoNetworkOverflow(page);
      await expectNoCapture(page);
      await mkdir(resolve('docs/agent-network/evidence'), { recursive: true });
      await page.screenshot({
        path: resolve(`docs/agent-network/evidence/layout-${width}-${colorScheme}-200pct.png`),
      });
    });
