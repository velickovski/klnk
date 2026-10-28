import { test, expect } from '@playwright/test';
import { apiPath, chooseType, enterSimulation, expectNoCapture, installNoCaptureProbe, settingsProfile } from './helpers';

test.beforeEach(async ({ page, context }, testInfo) => {
  await context.setExtraHTTPHeaders({ 'x-klnk-test-client': testInfo.testId });
  await installNoCaptureProbe(page);
});

test('VOICE-01 malformed Live readiness never requests microphone or paid session', async ({ page }) => {
  let starts = 0;
  page.on('request', request => { if (request.url() === apiPath('/voice/live/session')) starts++; });
  await page.route(apiPath('/demo/status'), route => route.fulfill({ status: 200, json: { configured: 'true', model: 'gpt-live-1', voice: 'marin' } }));
  await page.goto('/?legacy=1');
  await page.getByRole('button', { name: 'Call klnk', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expectNoCapture(page);
  expect(starts).toBe(0);
});

test('VOICE-01 microphone denial reaches a functional separate typed workspace', async ({ page }) => {
  let starts = 0;
  page.on('request', request => { if (request.url() === apiPath('/voice/live/session')) starts++; });
  await page.route(apiPath('/demo/status'), route => route.fulfill({ status: 200, json: { configured: true, model: 'gpt-live-1', voice: 'marin' } }));
  await page.goto('/?legacy=1');
  await page.getByRole('button', { name: 'Call klnk', exact: true }).click();
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Try the simulation', exact: true }).click();
  await expect(await chooseType(page)).toBeEditable();
  expect(await page.evaluate(() => (window as unknown as { __klnkQaMedia: { attempts: number } }).__klnkQaMedia.attempts)).toBe(1);
  expect(starts).toBe(0);
});

test('API-01 malformed successful auth stays signed out with a recoverable error', async ({ page }) => {
  await page.route(apiPath('/auth/demo'), route => route.fulfill({ status: 201, json: { user: { id: 'qa-invalid-auth' } } }));
  await page.goto('/?workspace=1&legacy=1');
  await page.getByRole('button', { name: 'Try the simulation', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try the simulation', exact: true })).toBeEnabled();
});

test('API-01 malformed successful bootstrap shows recovery instead of crashing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.name));
  await page.route(apiPath('/bootstrap'), route => route.fulfill({ status: 200, json: { profile: null, missions: 'invalid' } }));
  await page.goto('/?workspace=1&legacy=1');
  await page.getByRole('button', { name: 'Try the simulation', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('AUTH-01 late owner A unauthorized response cannot sign owner B out', async ({ page }) => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let intercepted!: () => void;
  const firstRequest = new Promise<void>(resolve => { intercepted = resolve; });
  let held = false;
  await page.route(apiPath('/integrations'), async route => {
    if (held) return route.continue();
    held = true;
    intercepted();
    await delayed;
    await route.fulfill({ status: 401, json: { error: 'unauthorized', message: 'Fictional old-owner expiry.' } }).catch(() => {});
  });
  try {
    await enterSimulation(page);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await firstRequest;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Try the simulation', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
    const completed = page.waitForResponse(response => response.url() === apiPath('/integrations') && response.status() === 401).catch(() => null);
    release();
    // A repaired epoch cancels the old fetch; the still-rendered tab is the authority.
    await Promise.race([completed, page.waitForTimeout(300)]);
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'People', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add a person', exact: true })).toBeVisible();
    await expect(page.getByText('Fictional old-owner expiry.', { exact: true })).toHaveCount(0);
  } finally { release(); }
});

test('AUTH-01 late successful owner A bootstrap cannot populate owner B profile', async ({ page }) => {
  await enterSimulation(page);
  await (await settingsProfile(page)).fill('QA fictional owner A profile');
  await Promise.all([
    page.waitForResponse(response => response.url() === apiPath('/bootstrap') && response.status() === 200),
    page.getByRole('button', { name: 'Save your preferences', exact: true }).click(),
  ]);
  await expect(page.getByText('QA fictional owner A profile', { exact: true })).toBeVisible();
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let captured!: () => void;
  const snapshotReady = new Promise<void>(resolve => { captured = resolve; });
  let finished!: () => void;
  const deliveryFinished = new Promise<void>(resolve => { finished = resolve; });
  let held = false;
  await page.route(apiPath('/bootstrap'), async route => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    const body = await response.body();
    captured();
    await delayed;
    try { await route.fulfill({ response, body }); } catch { /* Epoch cancellation may already have aborted this request. */ }
    finally { finished(); }
  });
  try {
    // RN Web AppState refreshes on the real browser visibilitychange event.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await snapshotReady;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Try the simulation', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
    release();
    await deliveryFinished;
    const name = await settingsProfile(page);
    await expect(name).toHaveValue('Alex Morgan');
    await expect(page.getByText('QA fictional owner A profile', { exact: true })).toHaveCount(0);
  } finally { release(); }
});

