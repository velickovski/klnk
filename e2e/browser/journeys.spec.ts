import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  apiPath,
  chooseType,
  enterSimulation,
  expectNoCapture,
  installNoCaptureProbe,
  settingsProfile,
  startSimulation,
  showLocalDemo,
} from './helpers';

test.beforeEach(async ({ page, context }, testInfo) => {
  await context.setExtraHTTPHeaders({ 'x-klnk-test-client': testInfo.testId });
  await installNoCaptureProbe(page);
});

test('VOICE-01 opening has one action and never captures on launch', async ({ page }, testInfo) => {
  const loadedBundle = page.waitForResponse((response) =>
    /^\/_expo\/static\/js\/web\/index-[a-f0-9]+\.js$/.test(new URL(response.url()).pathname),
  );
  await page.goto('/?legacy=1');
  const bundle = await loadedBundle,
    pathname = new URL(bundle.url()).pathname;
  const loadedHash = createHash('sha256')
    .update(await bundle.body())
    .digest('hex');
  const exportedHash = createHash('sha256')
    .update(await readFile(resolve('apps/mobile/dist-e2e', '.' + pathname)))
    .digest('hex');
  expect(loadedHash).toBe(exportedHash);
  await testInfo.attach('actual-loaded-bundle', {
    body: JSON.stringify({ pathname, loadedSha256: loadedHash, exportedSha256: exportedHash }),
    contentType: 'application/json',
  });
  const call = page.getByRole('button', { name: 'Call klnk', exact: true });
  await expect(call).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(call).toBeFocused();
  await expectNoCapture(page);
});

test('REQ-01 typed exact message creates one simulated request without a mandatory composer', async ({
  page,
}, testInfo) => {
  await enterSimulation(page);
  const message = await chooseType(page);
  let starts = 0;
  page.on('request', (request) => {
    if (request.url() === apiPath('/voice/turn') && request.method() === 'POST') starts++;
  });
  await message.fill('Call Jordan Lee and tell him I am near the fountain.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Request details', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review this conversation', exact: true }),
  ).toHaveCount(0);
  expect(starts).toBe(1);
  await page.getByRole('button', { name: 'Request details', exact: true }).click();
  const details = page.getByRole('dialog');
  await expect(details).toBeVisible();
  await expect(details.getByText('SIMULATED', { exact: true })).toBeVisible();
  await expect(
    details.getByText(
      'This is a simulated conversation with fictional responses. No one was contacted.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    details.getByText('Message delivered; recipient acknowledged it. No new commitment made.', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  if (process.env.KLNK_E2E_SCREENSHOTS === 'true')
    await testInfo.attach('fictional-simulated-request-result', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  expect(starts).toBe(1);
  await expectNoCapture(page);
});

test('AUTH-04 typed draft survives panel navigation and is cleared at owner change', async ({
  page,
}) => {
  await enterSimulation(page);
  await (await chooseType(page)).fill('QA fictional owner A unsent draft');
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await expect(await chooseType(page)).toHaveValue('QA fictional owner A unsent draft');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await startSimulation(page);
  await expect(await chooseType(page)).toHaveValue('');
  await expect(page.getByText('QA fictional owner A unsent draft', { exact: true })).toHaveCount(0);
  await expectNoCapture(page);
});

test('SETTINGS-01 unsaved profile survives navigation or offers Save/Discard/Stay', async ({
  page,
}) => {
  await enterSimulation(page);
  await (await settingsProfile(page)).fill('QA fictional unsaved name');
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  const stay = page.getByRole('button', { name: 'Stay and edit', exact: true });
  if (await stay.isVisible()) {
    await stay.click();
    await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveValue(
      'QA fictional unsaved name',
    );
  } else {
    await expect(await settingsProfile(page)).toHaveValue('QA fictional unsaved name');
  }
});

test('SETTINGS-01 failed profile save preserves draft and a real retry/refetch agrees', async ({
  page,
}) => {
  await enterSimulation(page);
  await (await settingsProfile(page)).fill('QA fictional saved preferences');
  await page.route(apiPath('/profile'), (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'qa_offline', message: 'Fictional QA preferences offline.' },
    }),
  );
  await page.getByRole('button', { name: 'Save your preferences', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await expect(await settingsProfile(page)).toHaveValue('QA fictional saved preferences');
  await page.unroute(apiPath('/profile'));
  await page.getByRole('button', { name: 'Save your preferences', exact: true }).click();
  await expect(page.getByText('Preferences saved.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await expect(await settingsProfile(page)).toHaveValue('QA fictional saved preferences');
});

test('SETTINGS-02 disposable account export is explicit and deletion clears its workspace', async ({
  page,
}) => {
  await enterSimulation(page);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Privacy and data', exact: true }).click();
  await page.getByRole('button', { name: 'Export your account data', exact: true }).click();
  await expect(
    page.getByText(
      'Export is ready. Select and copy the full data below, or open the sharing interface.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Share prepared export', exact: true }),
  ).toBeVisible();
  // Preparing the disposable fixture does not open an OS share or send data.
  await page.getByRole('button', { name: 'Hide prepared export', exact: true }).click();
  await page.getByRole('button', { name: 'Delete your account', exact: true }).click();
  await page.getByRole('button', { name: 'Keep your account', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete your account', exact: true }).click();
  const deleted = page.waitForResponse(
    (response) =>
      response.url() === apiPath('/account') &&
      response.request().method() === 'DELETE' &&
      response.status() === 200,
  );
  await page.getByRole('button', { name: 'Confirm account deletion', exact: true }).click();
  expect((await (await deleted).json()).ok).toBe(true);
  await showLocalDemo(page);
  await expect(page.getByRole('button', { name: 'Try the simulation', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Share prepared export', exact: true }),
  ).toHaveCount(0);
});

test('PEOPLE-02 failed save preserves fields and unsaved dismissal can stay or discard', async ({
  page,
}) => {
  await enterSimulation(page);
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add a person', exact: true });
  await add.click();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('QA fictional relationship');
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+12025550199');
  await page
    .getByRole('textbox', { name: 'Relationship', exact: true })
    .fill('QA fictional colleague');
  await page.route(apiPath('/contacts'), (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'qa_offline', message: 'Fictional QA offline fixture.' },
    }),
  );
  await page.getByRole('button', { name: 'Save relationship', exact: true }).click();
  await expect(page.getByText('Fictional QA offline fixture.', { exact: true })).toBeVisible();
  await expect(name).toHaveValue('QA fictional relationship');
  await page.getByRole('button', { name: 'Close Add a person', exact: true }).click();
  await page.getByRole('button', { name: 'Stay and edit', exact: true }).click();
  await expect(name).toHaveValue('QA fictional relationship');
  await page.getByRole('button', { name: 'Close Add a person', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(add).toBeFocused();
  await add.click();
  await expect(name).toHaveValue('');
});

test('MEMORY-02 failed save preserves private draft and provenance is explicit', async ({
  page,
}) => {
  await enterSimulation(page);
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await page.getByRole('button', { name: 'Add a memory', exact: true }).click();
  const text = page.getByRole('textbox', { name: 'Memory', exact: true });
  await text.fill('QA fictional private memory');
  await expect(
    page.getByRole('dialog').getByRole('radio', { name: 'Private', exact: true }),
  ).toBeChecked();
  await page.route(apiPath('/memories'), (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'qa_offline', message: 'Fictional QA memory save failed.' },
    }),
  );
  await page.getByRole('button', { name: 'Save memory', exact: true }).click();
  await expect(page.getByText('Fictional QA memory save failed.', { exact: true })).toBeVisible();
  await expect(text).toHaveValue('QA fictional private memory');
  await expectNoCapture(page);
});
