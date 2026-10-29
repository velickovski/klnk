import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { apiPath, expectNoCapture, installNoCaptureProbe } from './helpers';
import {
  connectMembers,
  enlargeTextAndSpacing,
  expectNoNetworkOverflow,
  guardContext,
  networkCall,
  registerNetwork,
  separateContext,
} from './network-helpers';

test.beforeEach(async ({ context, page }, info) => {
  await context.setExtraHTTPHeaders({ 'x-klnk-test-client': info.testId });
  await guardContext(context);
  await installNoCaptureProbe(page);
});

async function expectTextInside(locator: Locator, control = true) {
  const fit = await locator.evaluate((node, control) => {
    const box = node.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    const text = range.getBoundingClientRect();
    // Font ink may extend past a Text element's line box without clipping.
    // Controls must contain their labels; headings must fit actual clipping ancestors.
    if (
      control &&
      !(
        text.left >= box.left - 1 &&
        text.right <= box.right + 1 &&
        text.top >= box.top - 1 &&
        text.bottom <= box.bottom + 1
      )
    )
      return false;
    if (
      text.left < -1 ||
      text.right > innerWidth + 1 ||
      text.top < -1 ||
      text.bottom > innerHeight + 1
    )
      return false;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent),
        clip = parent.getBoundingClientRect();
      if (
        ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) &&
        (text.left < clip.left - 1 || text.right > clip.right + 1)
      )
        return false;
      if (
        ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) &&
        (text.top < clip.top - 1 || text.bottom > clip.bottom + 1)
      )
        return false;
    }
    return true;
  }, control);
  expect(fit).toBe(true);
}

async function expectWholeWord(locator: Locator) {
  const lineTops = await locator.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    // Ink can exceed line-height even on one line. Count occupied text fragments,
    // so a real character wrap is caught without treating font leading as clipping.
    return [
      ...new Set(
        Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => Math.round(rect.top * 100) / 100),
      ),
    ];
  });
  expect(lineTops).toHaveLength(1);
}

for (const width of [320, 390, 430]) {
  test(`workspace design ${width}px keeps shared headers and keyboard navigation usable at large text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await registerNetwork(page, `Fictional design ${width}`, 'call');
    await mkdir('.data/workspace-style-qa', { recursive: true });
    const naturalTitleFonts = new Map<string, number>();
    for (const enlarged of [false, true]) {
      if (enlarged) await enlargeTextAndSpacing(page);
      await page.getByRole('tab', { name: 'Inbox', exact: true }).click();
      await page.getByRole('tab', { name: 'Inbox', exact: true }).focus();
      for (const name of ['Inbox', 'Calendar', 'People', 'Memory', 'Settings']) {
        const tab = page.getByRole('tab', { name, exact: true });
        await expect(tab).toBeFocused();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(tab).toBeInViewport({ ratio: 1 });
        await expectTextInside(tab);
        const heading = page.locator(`#network-heading-${name}`);
        await expect(heading).toHaveText(name);
        await expect(heading).toBeInViewport({ ratio: 1 });
        await expectTextInside(heading, false);
        await expectWholeWord(heading);
        const font = await heading.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        if (enlarged) expect(font).toBe(naturalTitleFonts.get(name)! * 2);
        else naturalTitleFonts.set(name, font);
        const panel = page.getByTestId(`network-screen-${name.toLowerCase()}`);
        expect(
          await panel.evaluate((node) => ({
            transform: getComputedStyle(node).transform,
            animation: getComputedStyle(node).animationName,
          })),
        ).toEqual({ transform: 'none', animation: 'none' });
        await expectNoNetworkOverflow(page);
        if (name === 'Settings' && enlarged) {
          for (const label of ['Delegation', 'Preferences']) {
            await expectWholeWord(
              page
                .getByRole('button', { name: label, exact: true })
                .getByText(label, { exact: true }),
            );
          }
        }
        if ((width === 390 && !enlarged) || (width === 320 && enlarged)) {
          await page.screenshot({
            path: `.data/workspace-style-qa/${width}-${name.toLowerCase()}-${enlarged ? '2x' : '1x'}.png`,
          });
        }
        if (name !== 'Settings') await page.keyboard.press('ArrowRight');
      }
    }
    await expectNoCapture(page);
  });
}

test('workspace preferences keep unsaved choices through disclosure collapse and navigation without saving', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const account = await registerNetwork(page, 'Fictional preference design', 'call');
  const before = await networkCall(context, account, '/network/preferences');
  const puts: string[] = [];
  page.on('request', (request) => {
    if (request.url() === apiPath('/network/preferences') && request.method() === 'PUT')
      puts.push(request.url());
  });
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const preferences = page.getByRole('button', { name: 'Preferences', exact: true });
  await expect(preferences).toHaveAttribute('aria-expanded', 'false');
  await preferences.focus();
  await page.keyboard.press('Enter');
  const sevenDays = page.getByRole('radio', { name: '7 days', exact: true });
  const quiet = page.getByRole('radio', { name: 'Quiet', exact: true });
  await sevenDays.click();
  await quiet.click();
  await expect(sevenDays).toBeChecked();
  await expect(quiet).toBeChecked();
  await preferences.click();
  await expect(preferences).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('radio', { name: '7 days', exact: true })).toHaveCount(0);
  await preferences.click();
  await expect(sevenDays).toBeChecked();
  await expect(quiet).toBeChecked();
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const reopened = page.getByRole('button', { name: 'Preferences', exact: true });
  if ((await reopened.getAttribute('aria-expanded')) !== 'true') await reopened.click();
  await expect(sevenDays).toBeChecked();
  await expect(quiet).toBeChecked();

  // Exercise press feedback without committing this unsaved preference change.
  const save = page.getByRole('button', { name: 'Save privacy preferences', exact: true });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect
    .poll(() =>
      save.evaluate(
        (node) => new DOMMatrixReadOnly(getComputedStyle(node.parentElement!).transform).a,
      ),
    )
    .toBeLessThan(0.995);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => save.evaluate((node) => getComputedStyle(node.parentElement!).transform))
    .toBe('none');
  await page.mouse.move(1, 1);
  await page.mouse.up();
  expect(puts).toEqual([]);
  // An owner with no saved row gets a fresh default updatedAt on each GET.
  // Scope/version/preferences, rather than that read-time stamp, prove no save.
  expect(await networkCall(context, account, '/network/preferences')).toMatchObject({
    ownerId: before.ownerId,
    version: before.version,
    retentionDays: before.retentionDays,
    notificationMode: before.notificationMode,
  });
  await expectNoCapture(page);
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`workspace sheet retains keyboard dismissal and focus with ${reducedMotion}`, async ({
    browser,
  }, info) => {
    const a = await separateContext(browser, info),
      b = await separateContext(browser, info);
    try {
      await a.page.emulateMedia({ reducedMotion });
      const alice = {
        ...a,
        account: await registerNetwork(a.page, 'Fictional sheet sender', 'call'),
      };
      const jordan = {
        ...b,
        account: await registerNetwork(b.page, 'Fictional sheet recipient', 'call'),
      };
      const connection = await connectMembers(alice, jordan);
      const purpose = 'Fictional sheet design message';
      await networkCall(a.context, alice.account, '/network/conversations', 'POST', {
        requestId: randomUUID(),
        connectionId: connection.id,
        kind: 'inform',
        purpose,
        topic: 'routine',
        message: 'Exact fictional message for local visual verification.',
        candidateSlots: [],
        location: '',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      await a.page.getByRole('tab', { name: 'Inbox', exact: true }).click();
      await a.page.getByRole('button', { name: 'Refresh Inbox', exact: true }).click();
      const trigger = a.page.getByRole('button', { name: `Open request: ${purpose}`, exact: true });
      await expect(trigger).toBeEnabled();
      await a.page.evaluate(() => {
        const starts: { duration: number; iterations: string }[] = [];
        Object.defineProperty(window, '__klnkSheetAnimationStarts', { value: starts });
        document.addEventListener('animationstart', (event) => {
          const target = event.target as HTMLElement;
          if (target.querySelector('[aria-modal="true"]')) {
            const style = getComputedStyle(target);
            starts.push({
              duration: parseFloat(style.animationDuration),
              iterations: style.animationIterationCount,
            });
          }
        });
      });
      await trigger.focus();
      await a.page.keyboard.press('Enter');
      const close = a.page.getByRole('button', { name: `Close ${purpose}`, exact: true });
      await expect(close).toBeFocused();
      await expect(a.page.getByRole('dialog')).toBeVisible();
      await mkdir('.data/workspace-style-qa', { recursive: true });
      await a.page.screenshot({ path: `.data/workspace-style-qa/sheet-${reducedMotion}.png` });
      if (reducedMotion === 'no-preference') {
        await expect
          .poll(() =>
            a.page.evaluate(
              () =>
                (window as unknown as { __klnkSheetAnimationStarts: unknown[] })
                  .__klnkSheetAnimationStarts.length,
            ),
          )
          .toBe(1);
      } else {
        expect(
          await a.page.evaluate(
            () =>
              (window as unknown as { __klnkSheetAnimationStarts: unknown[] })
                .__klnkSheetAnimationStarts,
          ),
        ).toEqual([]);
      }
      await a.page.keyboard.press('Escape');
      await expect(a.page.getByRole('dialog')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expectNoCapture(a.page);
      await expectNoCapture(b.page);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
}
