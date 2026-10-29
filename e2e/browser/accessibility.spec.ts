import { test, expect } from '@playwright/test';
import { enterSimulation, installNoCaptureProbe, enlargeTextAndSpacing } from './helpers';

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({ 'x-klnk-test-client': testInfo.testId });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 430]) {
    test(`A11Y-02 ${width}px ${colorScheme} opening and workspace reflow`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await installNoCaptureProbe(page);
      await page.goto('/?legacy=1');
      await expect(page.getByRole('button', { name: 'Call klnk', exact: true })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Your day. One conversation.', exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
      if (width === 390 && process.env.KLNK_E2E_SCREENSHOTS === 'true')
        await testInfo.attach(`fictional-opening-${width}-${colorScheme}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      await enterSimulation(page);
      for (const panel of ['Home', 'People', 'Memory', 'Settings']) {
        await page.getByRole('tab', { name: panel, exact: true }).click();
        await expect(page.getByRole('tab', { name: panel, exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expectNoHorizontalOverflow(page);
        if (width === 390 && process.env.KLNK_E2E_SCREENSHOTS === 'true')
          await testInfo.attach(`fictional-${panel.toLowerCase()}-${width}-${colorScheme}`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
      }
    });
    test(`A11Y-02 ${width}px ${colorScheme} enlarged People Memory targets and vertical text fit`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await installNoCaptureProbe(page);
      await enterSimulation(page);
      const metrics: unknown[] = [];
      for (const panel of ['People', 'Memory']) {
        await page.getByRole('tab', { name: panel, exact: true }).click();
        await enlargeTextAndSpacing(
          page,
          panel === 'People'
            ? [
                'Keep the context that helps your agent speak thoughtfully. Add only the people you choose.',
              ]
            : ['Inspect the source, review the claim, and choose what may be shared.'],
        );
        const tabs = page.getByRole('tab');
        await expect(tabs).toHaveCount(4);
        const measurements = await tabs.evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            const textBounds: { top: number; bottom: number; left: number; right: number }[] = [];
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
              if (!node.textContent?.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              const text = range.getBoundingClientRect();
              textBounds.push({
                top: text.top,
                bottom: text.bottom,
                left: text.left,
                right: text.right,
              });
            }
            return {
              name: element.getAttribute('aria-label'),
              width: box.width,
              height: box.height,
              top: box.top,
              bottom: box.bottom,
              verticalTextFits: textBounds.every(
                (text) => text.top >= box.top - 1 && text.bottom <= box.bottom + 1,
              ),
              horizontalTextFits: textBounds.every(
                (text) => text.left >= box.left - 1 && text.right <= box.right + 1,
              ),
            };
          }),
        );
        for (const measured of measurements) {
          expect(measured.width).toBeGreaterThanOrEqual(44);
          expect(measured.height).toBeGreaterThanOrEqual(44);
          expect(measured.top).toBeGreaterThanOrEqual(0);
          expect(measured.bottom).toBeLessThanOrEqual(845);
          expect(measured.verticalTextFits).toBe(true);
          expect(measured.horizontalTextFits).toBe(true);
        }
        const add = page.getByRole('button', {
          name: panel === 'People' ? 'Add a person' : 'Add a memory',
          exact: true,
        });
        await add.scrollIntoViewIfNeeded();
        await expect(add).toBeInViewport({ ratio: 1 });
        const actionFit = await add.evaluate((element) => {
          const box = element.getBoundingClientRect(),
            walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (!node.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            const text = range.getBoundingClientRect();
            if (text.top < box.top - 1 || text.bottom > box.bottom + 1) return false;
          }
          let clipTop = 0,
            clipBottom = window.innerHeight;
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowY)) {
              const clip = parent.getBoundingClientRect();
              clipTop = Math.max(clipTop, clip.top);
              clipBottom = Math.min(clipBottom, clip.bottom);
            }
          }
          return (
            box.width >= 44 &&
            box.height >= 44 &&
            box.top >= clipTop - 1 &&
            box.bottom <= clipBottom + 1
          );
        });
        expect(actionFit).toBe(true);
        await expectNoHorizontalOverflow(page);
        metrics.push({ panel, navigation: measurements, primaryActionFits: actionFit });
        if (width === 320 && process.env.KLNK_E2E_SCREENSHOTS === 'true')
          await testInfo.attach(`fictional-enlarged-${panel.toLowerCase()}-${colorScheme}`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
      }
      await testInfo.attach('fictional-enlarged-reflow-metrics', {
        body: JSON.stringify({ width, colorScheme, metrics }, null, 2),
        contentType: 'application/json',
      });
    });
  }
}

test('A11Y-02 combined text spacing and 200 percent text retain the opening action', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await installNoCaptureProbe(page);
  await page.goto('/?legacy=1');
  await page.getByRole('button', { name: 'Call klnk', exact: true }).waitFor();
  // RN Web resolves text in px, so root font-size alone would not test text enlargement.
  await enlargeTextAndSpacing(page, [
    '5 min · Voice with OpenAI\nMicrophone starts when you call.',
  ]);
  const call = page.getByRole('button', { name: 'Call klnk', exact: true });
  await call.scrollIntoViewIfNeeded();
  await expect(call).toBeVisible();
  const box = await call.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
});

test('A11Y-01 keyboard opens and dismisses a clean sheet and restores its trigger', async ({
  page,
}) => {
  await installNoCaptureProbe(page);
  await enterSimulation(page);
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add a person', exact: true });
  await add.focus();
  await page.keyboard.press('Enter');
  const close = page.getByRole('button', { name: 'Close Add a person', exact: true });
  await expect(close).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(close).toHaveCount(0);
  await expect(add).toBeFocused();
});

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}
