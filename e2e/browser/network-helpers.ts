import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiPath, installNoCaptureProbe } from './helpers';

/** Persistent test-only text accommodation. React can replace fields and virtual
 * rows after the initial pass; CSS overrides survive style updates, and an
 * observer measures new nodes with the accommodation sheet disabled first. */
export async function enlargeTextAndSpacing(page: Page, paragraphs: string[] = []) {
  await page.evaluate((paragraphs) => {
    type Fixture = { refresh: (paragraphs: string[]) => void };
    const fixtureWindow = window as unknown as { klnkQaTextFixture?: Fixture };
    if (fixtureWindow.klnkQaTextFixture) {
      fixtureWindow.klnkQaTextFixture.refresh(paragraphs);
      return;
    }
    const sheet = document.createElement('style');
    const stableMeasurement = document.createElement('style');
    stableMeasurement.dataset.klnkQaFontMeasurement = 'true';
    stableMeasurement.textContent =
      '*,*::before,*::after{transition-property:none!important;animation-name:none!important}';
    document.head.append(stableMeasurement);
    sheet.dataset.klnkQaTextAccommodation = 'true';
    document.head.append(sheet);
    const identifiers = new WeakMap<HTMLElement, number>();
    const paragraphTexts = new Set(paragraphs);
    let nextId = 0;
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        apply();
      });
    });
    function apply() {
      observer.disconnect();
      // Keep the measurement rule active while removing font overrides. Even a
      // reduced-motion .01ms transition otherwise exposes its old computed size
      // during this synchronous measurement and would compound the next pass.
      sheet.remove();
      // Measuring without this stylesheet avoids doubling inherited,
      // already-enlarged text when a descendant is mounted in a later batch.
      const targets = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
        (element) =>
          !element.matches('script,style,noscript') &&
          !element.closest('[aria-hidden="true"]') &&
          (element.matches('input,textarea,select') ||
            Array.from(element.childNodes).some(
              (child) => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim(),
            )),
      );
      const naturalSizes = targets.map((element) => parseFloat(getComputedStyle(element).fontSize));
      const rules: string[] = [];
      targets.forEach((element, index) => {
        const natural = naturalSizes[index];
        if (!Number.isFinite(natural) || natural <= 0) return;
        let id = identifiers.get(element);
        if (id === undefined) {
          id = ++nextId;
          identifiers.set(element, id);
        }
        element.dataset.klnkQaTextId = String(id);
        element.dataset.klnkQaBaseFont = String(natural);
        rules.push(
          `[data-klnk-qa-text-id="${id}"]{font-size:${natural * 2}px!important;line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important;${paragraphTexts.has(element.textContent?.trim() ?? '') ? 'margin-bottom:2em!important;' : ''}}`,
        );
      });
      sheet.textContent = rules.join('\n');
      document.head.append(sheet);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'aria-hidden'],
      });
    }
    fixtureWindow.klnkQaTextFixture = {
      refresh: (texts) => {
        let changed = false;
        texts.forEach((text) => {
          if (!paragraphTexts.has(text)) {
            paragraphTexts.add(text);
            changed = true;
          }
        });
        if (changed) apply();
      },
    };
    apply();
  }, paragraphs);
}

export type NetworkAccount = {
  token: string;
  user: { id: string };
  email: string;
  password: string;
  name: string;
};
export const egressProbes: { external: number }[] = [];
export async function guardContext(context: BrowserContext) {
  const probe = { external: 0 };
  egressProbes.push(probe);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:8083' || url.origin === 'http://127.0.0.1:4102')
      await route.continue();
    else {
      probe.external++;
      await route.abort('blockedbyclient');
    }
  });
  return probe;
}
export async function separateContext(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'x-klnk-test-client': testInfo.testId + '-' + randomUUID() },
  });
  await guardContext(context);
  const page = await context.newPage();
  await installNoCaptureProbe(page);
  return { context, page };
}
export async function registerNetwork(
  page: Page,
  name: string,
  entry: 'workspace' | 'call' = 'workspace',
): Promise<NetworkAccount> {
  const email = `${randomUUID()}@example.invalid`,
    password = 'Fictional network browser password';
  await page.goto(entry === 'call' ? '/' : '/?workspace=1');
  if (entry === 'call') await page.getByRole('button', { name: 'Call klnk', exact: true }).click();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  const registered = page.waitForResponse(
    (r) => r.url() === apiPath('/auth/register') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  const response = await registered;
  expect(response.status()).toBe(202);
  // Development's explicit sign-in follows the same generic registration
  // acknowledgement as production; registration never supplies a token.
  expect(await response.json()).not.toHaveProperty('token');

  const signedIn = page.waitForResponse(
    (r) => r.url() === apiPath('/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const login = await signedIn;
  expect(login.status()).toBe(200);
  const result = await login.json();
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toBeVisible();
  return { ...result, email, password, name };
}
export async function loginNetwork(page: Page, account: NetworkAccount) {
  await page.goto('/?workspace=1');

  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(account.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toBeVisible();
}
export async function networkCall(
  context: BrowserContext,
  account: NetworkAccount,
  path: string,
  method = 'GET',
  data?: unknown,
) {
  const response = await context.request.fetch(apiPath(path), {
    method,
    headers: { authorization: `Bearer ${account.token}` },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
export async function connectMembers(
  alice: { context: BrowserContext; page: Page; account: NetworkAccount },
  jordan: { context: BrowserContext; page: Page; account: NetworkAccount },
) {
  const identity = await networkCall(jordan.context, jordan.account, '/network/identity');
  await alice.page.getByRole('tab', { name: 'People', exact: true }).click();
  await alice.page
    .getByRole('textbox', { name: 'Member code', exact: true })
    .fill(identity.member.memberCode);
  await alice.page.getByRole('button', { name: 'Request connection', exact: true }).click();
  await expect(alice.page.getByText('Awaiting their acceptance', { exact: true })).toBeVisible();
  await jordan.page.getByRole('tab', { name: 'People', exact: true }).click();
  await jordan.page.getByRole('button', { name: 'Refresh People', exact: true }).click();
  await jordan.page
    .getByRole('button', { name: `Accept ${alice.account.name}'s connection`, exact: true })
    .click();
  await expect(jordan.page.getByText('Connected', { exact: true })).toBeVisible();
  await alice.page.getByRole('button', { name: 'Refresh People', exact: true }).click();
  await expect(alice.page.getByText('Connected', { exact: true })).toBeVisible();
  return (await networkCall(alice.context, alice.account, '/network/connections')).connections[0];
}
/** Explicit fictional fixture grant through authenticated production routes.
 * Connection acceptance never creates this grant implicitly. */
export async function seedRule(
  context: BrowserContext,
  account: NetworkAccount,
  peer: NetworkAccount,
  patch: Record<string, unknown> = {},
) {
  const { ownerId, version, updatedAt, authorityVersions, ...policy } = await networkCall(
    context,
    account,
    '/network/policy',
  );
  // This is an explicit manual-availability fixture, not inferred free time.
  await networkCall(context, account, '/network/calendar/availability', 'PUT', {
    confirmedThrough: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  return networkCall(context, account, '/network/policy', 'PUT', {
    expectedVersion: version,
    policy: {
      ...policy,
      enabled: true,
      trustedMemberIds: [peer.user.id],
      topics: ['routine'],
      allowMessages: true,
      allowQuestions: true,
      allowMeetings: true,
      autoAcceptMeetings: true,
      minNoticeMinutes: 0,
      workStartMinute: 0,
      workEndMinute: 1440,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      ...patch,
    },
  });
}
export function meetingInput(connectionId: string, purpose = 'Fictional launch planning') {
  const start = new Date(Date.now() + 86400000);
  start.setUTCHours(14, 0, 0, 0);
  return {
    requestId: randomUUID(),
    connectionId,
    kind: 'meeting',
    purpose,
    topic: 'routine',
    message: 'Find a permitted half hour for this exact purpose.',
    candidateSlots: [
      {
        startAt: start.toISOString(),
        endAt: new Date(+start + 1800000).toISOString(),
        timezone: 'UTC',
      },
    ],
    location: 'Fictional blue gate',
    expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  };
}
export async function expectNoNetworkOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}
