import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { apiPath, enlargeTextAndSpacing, expectNoCapture, installNoCaptureProbe } from './helpers';
import {
  guardContext,
  registerNetwork,
  networkCall,
  separateContext,
  connectMembers,
  seedRule,
  meetingInput,
  expectNoNetworkOverflow,
} from './network-helpers';

test.beforeEach(async ({ context, page }, info) => {
  await context.setExtraHTTPHeaders({ 'x-klnk-test-client': info.testId });
  await guardContext(context);
  await installNoCaptureProbe(page);
});

test('independent default entry exposes one action and reaches genuine pending registration with SMTP disabled', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Call klnk', exact: true })).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await mkdir('docs/review/2026-10-28/evidence', { recursive: true });
  await page.screenshot({ path: 'docs/review/2026-10-28/evidence/qa-independent-call-entry.png' });
  await page.getByRole('button', { name: 'Call klnk', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/review/2026-10-28/evidence/qa-independent-auth-entry.png' });
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your name', exact: true })
    .fill('Fictional independent owner');
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill(`${randomUUID()}@example.invalid`);
  await page
    .getByRole('textbox', { name: 'Password', exact: true })
    .fill('Fictional browser password 42');
  const pending = page.waitForResponse(
    (r) => r.url() === apiPath('/auth/register') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(202);
  expect(await response.json()).toMatchObject({
    accepted: true,
    status: 'pending',
    delivery: 'disabled',
  });
  expect(await response.json()).not.toHaveProperty('token');
  await expect(page.getByText(/Email sending is disabled in this local build/)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toHaveCount(0);
  await expectNoCapture(page);
});

test('independent real eighty-row Memory collection scrolls at large text and retains a focused draft through history', async ({
  page,
  context,
}, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const account = await registerNetwork(page, 'Fictional independent collection owner', 'call');
  const expiry = new Date(Date.now() + 86400000).toISOString();
  for (let index = 1; index <= 80; index++) {
    const saved = await context.request.post(apiPath('/network/memories'), {
      headers: {
        authorization: `Bearer ${account.token}`,
        'x-klnk-test-client': info.testId + '-seed',
      },
      data: {
        text: `Independent private row ${index}`,
        topic: `Independent topic ${index}`,
        sharing: 'private',
        memberIds: [],
        confirmed: false,
        expiresAt: expiry,
      },
    });
    expect(saved.status()).toBe(200);
  }
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await expect(page.getByText('Independent private row 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Independent private row 80', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add network memory', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Memory text', exact: true });
  await input.pressSequentially('Unsaved independent draft');
  await expect(input).toBeFocused();
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/workspace\/memory$/);
  await expect(input).toHaveValue('Unsaved independent draft');
  await input.focus();
  await input.pressSequentially(' after return');
  await expect(input).toBeFocused();
  await enlargeTextAndSpacing(page);
  await expectNoNetworkOverflow(page);
  const collection = page.getByTestId('network-memory');
  const scrollEvidence: unknown[] = [];
  await expect
    .poll(
      async () => {
        await enlargeTextAndSpacing(page);
        await collection.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        scrollEvidence.push(
          await collection.evaluate((el) => ({
            top: el.scrollTop,
            height: el.scrollHeight,
            viewport: el.clientHeight,
            focused: document.activeElement?.getAttribute('aria-label'),
            rows: Array.from(el.querySelectorAll('h1'))
              .map((item) => item.textContent)
              .filter((value) => value?.startsWith('Independent topic')),
          })),
        );
        return page.getByText('Independent private row 80', { exact: true }).isVisible();
      },
      { intervals: [100, 200, 250] },
    )
    .toBe(true)
    .catch(async (error) => {
      await test.info().attach('collection-scroll-evidence', {
        body: JSON.stringify(scrollEvidence),
        contentType: 'application/json',
      });
      throw error;
    });
  // A virtualized final batch may mount after the poll's last scaling pass.
  await enlargeTextAndSpacing(page);
  const finalRow = page.getByText('Independent private row 80', { exact: true });
  await finalRow.scrollIntoViewIfNeeded();
  await expect(finalRow).toBeInViewport();
  const finalFont = await finalRow.evaluate((element) => ({
    actual: parseFloat(getComputedStyle(element).fontSize),
    base: Number((element as HTMLElement).dataset.klnkQaBaseFont),
  }));
  expect(finalFont.base).toBeGreaterThan(0);
  expect(finalFont.actual).toBeCloseTo(finalFont.base * 2, 1);
  await mkdir('docs/review/2026-10-28/evidence', { recursive: true });
  await page.screenshot({
    path: 'docs/review/2026-10-28/evidence/qa-independent-memory-80-large-text.png',
  });
  await expectNoNetworkOverflow(page);
  await expectNoCapture(page);
});

test('independent join reload requires sign-in and prefill; URL history never sends an invitation', async ({
  page,
  context,
}) => {
  const account = await registerNetwork(page, 'Fictional independent join opener', 'call');
  const code = 'klnk_independentFictionalCode';
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url() === apiPath('/network/connections') && request.method() === 'POST')
      writes.push(request.postData() ?? '');
  });
  await page.goto(`/join/${code}`);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(account.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Member code', exact: true })).toHaveValue(code);
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/memory$/);
  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'Member code', exact: true })).toHaveValue(code);
  expect(writes).toEqual([]);
  expect((await networkCall(context, account, '/network/connections')).connections).toEqual([]);
  await expectNoCapture(page);
});

test('independent same-page owner change removes private cached rows and unsaved drafts', async ({
  page,
  context,
}) => {
  const first = await registerNetwork(page, 'Fictional departed owner', 'call');
  await networkCall(context, first, '/network/memories', 'POST', {
    text: 'Private record belonging only to the departed owner',
    topic: 'Independent private scope',
    sharing: 'private',
    memberIds: [],
    confirmed: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await expect(
    page.getByText('Private record belonging only to the departed owner', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add network memory', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Memory text', exact: true })
    .fill('Private unsaved departed draft');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Fictional fresh owner');
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill(`${randomUUID()}@example.invalid`);
  await page
    .getByRole('textbox', { name: 'Password', exact: true })
    .fill('Fictional fresh browser password');
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await expect(page.getByText('Your context starts with you', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Private record belonging only to the departed owner', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Memory text', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add network memory', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Memory text', exact: true })).toHaveValue('');
  await expectNoCapture(page);
});

test('independent Calendar opens its actual agreed request and returns focus after closing the detail', async ({
  browser,
}, info) => {
  const a = await separateContext(browser, info),
    b = await separateContext(browser, info);
  try {
    const alice = {
      ...a,
      account: await registerNetwork(a.page, 'Fictional independent sender', 'call'),
    };
    const jordan = {
      ...b,
      account: await registerNetwork(b.page, 'Fictional independent recipient', 'call'),
    };
    const connection = await connectMembers(alice, jordan);
    await seedRule(a.context, alice.account, jordan.account);
    await seedRule(b.context, jordan.account, alice.account);
    const input = meetingInput(connection.id, 'Independent calendar navigation agreement');
    const conversation = await networkCall(
      a.context,
      alice.account,
      '/network/conversations',
      'POST',
      input,
    );
    await expect
      .poll(
        async () =>
          (await networkCall(a.context, alice.account, `/network/conversations/${conversation.id}`))
            .state,
      )
      .toBe('agreed');
    await a.page.getByRole('tab', { name: 'Calendar', exact: true }).click();
    await a.page
      .getByRole('button', { name: `Open conversation: ${input.purpose}`, exact: true })
      .click();
    await expect(a.page).toHaveURL(new RegExp(`/workspace/inbox/${conversation.id}$`));
    await expect(a.page.getByRole('dialog')).toBeVisible();
    await a.page.getByRole('button', { name: `Close ${input.purpose}`, exact: true }).click();
    await expect(a.page.getByRole('dialog')).toHaveCount(0);
    const trigger = a.page.getByRole('button', {
      name: `Open request: ${input.purpose}`,
      exact: true,
    });
    await trigger.click();
    await a.page.keyboard.press('Escape');
    await expect(a.page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger)
      .toBeFocused()
      .catch(async (error) => {
        const diagnostic = await trigger.evaluate((element) => {
          const row = element as HTMLElement;
          const describe = (value: Element | null) =>
            value
              ? {
                  tag: value.tagName,
                  id: value.id,
                  label: value.getAttribute('aria-label'),
                  role: value.getAttribute('role'),
                }
              : null;
          const ancestors: unknown[] = [];
          let parent: HTMLElement | null = row;
          while (parent) {
            ancestors.push({
              tag: parent.tagName,
              id: parent.id,
              hidden: parent.getAttribute('aria-hidden'),
              inert: parent.inert,
            });
            parent = parent.parentElement;
          }
          const before = describe(document.activeElement);
          const ownsFocus = Object.hasOwn(row, 'focus');
          const usesPrototypeFocus = row.focus === HTMLElement.prototype.focus;
          row.focus();
          const instanceFocus = describe(document.activeElement);
          HTMLElement.prototype.focus.call(row);
          const prototypeFocus = describe(document.activeElement);
          return {
            before,
            instanceFocus,
            prototypeFocus,
            ownsFocus,
            usesPrototypeFocus,
            connected: row.isConnected,
            disabled: row.getAttribute('disabled'),
            tabIndex: row.tabIndex,
            ancestors,
          };
        });
        await writeFile('.data/qa-inbox-focus.json', JSON.stringify(diagnostic, null, 2));
        await test.info().attach('inbox-focus-diagnostic', {
          body: JSON.stringify(diagnostic),
          contentType: 'application/json',
        });
        throw error;
      });
    await expectNoCapture(a.page);
    await expectNoCapture(b.page);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('independent unsaved controls expose checked markup and real tab keyboard navigation', async ({
  page,
  context,
}) => {
  const account = await registerNetwork(page, 'Fictional independent settings owner', 'call');
  await page.getByRole('tab', { name: 'Inbox', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Calendar', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'People', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Enable background delegation', exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect((await networkCall(context, account, '/network/policy')).enabled).toBe(false);
  await expectNoCapture(page);
});
