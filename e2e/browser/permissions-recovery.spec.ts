import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  apiPath,
  chooseType,
  enterSimulation,
  expectNoCapture,
  installNoCaptureProbe,
} from './helpers';

test.beforeEach(async ({ page, context }, testInfo) => {
  await context.setExtraHTTPHeaders({ 'x-klnk-test-client': testInfo.testId });
  await installNoCaptureProbe(page);
});

test('SETTINGS-03 mocked eligibility gates actual grant PUT, readback and revocation without enabling runtime', async ({
  page,
}, testInfo) => {
  let eligibility = false;
  const saves: { enabled: boolean; tools: string[] }[] = [],
    reads: { enabled: boolean; runtimeAvailable: boolean }[] = [];
  page.on('request', (request) => {
    if (request.url() === apiPath('/tools/access') && request.method() === 'PUT')
      saves.push(JSON.parse(request.postData()!));
  });
  await page.route(apiPath('/tools/access'), async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(),
      body = await response.json();
    reads.push({ enabled: body.grant.enabled, runtimeAvailable: body.runtimeAvailable });
    // Only capability presentation is mocked. Owner, grant and every mutation remain real.
    await route.fulfill({ response, json: { ...body, runtimeAvailable: eligibility } });
  });
  await enterSimulation(page);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Voice permissions and activity', exact: true }).click();
  const allow = page.getByRole('button', { name: 'Allow in-app voice tools', exact: true });
  await expect(allow).toBeDisabled();
  await expect(page.getByText('Voice permissions off', { exact: true })).toBeVisible();
  expect(saves).toEqual([]);
  eligibility = true;
  await page.getByRole('button', { name: 'Refresh voice permissions', exact: true }).click();
  await expect(allow).toBeEnabled();
  const accepted = page.waitForResponse(
    (response) =>
      response.url() === apiPath('/tools/access') && response.request().method() === 'PUT',
  );
  await allow.click();
  expect((await (await accepted).json()).runtimeAvailable).toBe(false);
  await expect(page.getByText('Voice permissions on', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'In-app voice tools are unavailable on this server. Permissions are not being enabled by a connection or credential alone.',
      { exact: true },
    ),
  ).toBeVisible();
  if (process.env.KLNK_E2E_SCREENSHOTS === 'true')
    await testInfo.attach('fictional-tools-enabled-runtime-unavailable', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  eligibility = false;
  await page.getByRole('button', { name: 'Refresh voice permissions', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Turn off voice tools', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Turn off voice tools', exact: true }).click();
  await expect(page.getByText('Voice permissions off', { exact: true })).toBeVisible();
  await expect(allow).toBeDisabled();
  const finalRead = page.waitForResponse(
    (response) =>
      response.url() === apiPath('/tools/access') && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Refresh voice permissions', exact: true }).click();
  await finalRead;
  await expect(page.getByText('Voice permissions off', { exact: true })).toBeVisible();
  expect(reads.some((read) => read.enabled)).toBe(true);
  expect(reads.at(-1)).toEqual({ enabled: false, runtimeAvailable: false });
  expect(saves).toEqual([
    {
      enabled: true,
      tools: ['contacts_lookup', 'memory_lookup', 'request_prepare', 'request_status'],
    },
    {
      enabled: false,
      tools: ['contacts_lookup', 'memory_lookup', 'request_prepare', 'request_status'],
    },
  ]);
  await expectNoCapture(page);
});

test('SETTINGS-03 a mocked foreign-owner permission response cannot enable or save access', async ({
  page,
}) => {
  let mutations = 0;
  page.on('request', (request) => {
    if (request.url() === apiPath('/tools/access') && request.method() === 'PUT') mutations++;
  });
  await page.route(apiPath('/tools/access'), async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(),
      body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        runtimeAvailable: true,
        grant: { ...body.grant, ownerId: randomUUID(), enabled: true },
      },
    });
  });
  await enterSimulation(page);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Voice permissions and activity', exact: true }).click();
  await expect(
    page.getByText('Voice permissions are not verified. Refresh before changing access.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Allow in-app voice tools', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Turn off voice tools', exact: true })).toHaveCount(
    0,
  );
  expect(mutations).toBe(0);
  await expectNoCapture(page);
});

for (const terminal of [false, true]) {
  test(`VOICE-04 mocked asynchronous no-ID recovery ${terminal ? 'reconciles rejection' : 'keeps uncertainty'} and preserves typed access without automatic start`, async ({
    page,
  }, testInfo) => {
    let release!: () => void, observed!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      requested = new Promise<void>((resolve) => {
        observed = resolve;
      });
    const receipt = {
      requestId: randomUUID(),
      receiptId: randomUUID(),
      status: 'unconfirmed',
      expiresAt: Date.now() + 300000,
    };
    let creations = 0;
    page.on('request', (request) => {
      if (request.url() === apiPath('/voice/live/session') && request.method() === 'POST')
        creations++;
    });
    await page.route(apiPath('/voice/live/recovery'), async (route) => {
      observed();
      await gate;
      await route.fulfill({ status: 200, json: { requests: [receipt] } });
    });
    if (terminal)
      await page.route(apiPath(`/voice/live/requests/${receipt.requestId}`), (route) =>
        route.fulfill({ status: 200, json: { ...receipt, status: 'rejected' } }),
      );
    try {
      await enterSimulation(page);
      await requested;
      await page.getByRole('button', { name: 'Back to voice home', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Call klnk', exact: true })).toBeVisible();
      await expect(page.getByRole('button')).toHaveCount(1);
      release();
      await expect(
        page.getByRole('button', { name: 'Retry ending session', exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Check the earlier session.', { exact: true })).toBeVisible();
      await expect(
        page.getByText(
          'Closure unconfirmed · Microphone off · Starting another conversation is blocked.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText('AI conversation ended · No telephone call was placed.', { exact: true }),
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open workspace', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Call klnk', exact: true })).toHaveCount(0);
      if (!terminal && process.env.KLNK_E2E_SCREENSHOTS === 'true')
        await testInfo.attach('fictional-no-id-recovery-error', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      if (terminal) {
        await page.getByRole('button', { name: 'Retry ending session', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Call klnk', exact: true })).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Retry ending session', exact: true }),
        ).toHaveCount(0);
      }
      await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
      await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
      await expect(await chooseType(page)).toBeEditable();
      expect(creations).toBe(0);
      await expectNoCapture(page);
    } finally {
      release();
    }
  });
}
