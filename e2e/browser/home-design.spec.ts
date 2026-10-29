import { expect, test } from '@playwright/test';
import { enlargeTextAndSpacing, expectNoCapture, installNoCaptureProbe } from './helpers';

for (const width of [320, 390, 430]) {
  test(`home design ${width}px preserves whole feature labels and the sole action at 200% text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installNoCaptureProbe(page);
    await page.goto('/');
    const call = page.getByRole('button', { name: 'Call klnk', exact: true });
    await expect(call).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(1);
    await expect(call).toBeInViewport({ ratio: 1 });
    await enlargeTextAndSpacing(page);
    for (const name of ['Meetings', 'Memory', 'Answers']) {
      const label = page.getByText(name, { exact: true });
      expect(
        await label.evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return (
            range.getBoundingClientRect().height <=
            parseFloat(getComputedStyle(node).lineHeight) + 1
          );
        }),
      ).toBe(true);
    }
    await call.scrollIntoViewIfNeeded();
    await expect(call).toBeInViewport({ ratio: 1 });
    expect(await call.evaluate((node) => getComputedStyle(node.parentElement!).transform)).toBe(
      'none',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await call.focus();
    await expect(call).toBeFocused();
    await expectNoCapture(page);
  });
}

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`home artwork uses finite motion and respects ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await installNoCaptureProbe(page);
    await page.addInitScript(() => {
      const starts: string[] = [];
      Object.defineProperty(window, '__klnkArtworkStarts', { value: starts });
      document.addEventListener('animationstart', (event) => {
        if ((event.target as Element)?.getAttribute('data-testid') === 'launch-artwork')
          starts.push((event as AnimationEvent).animationName);
      });
    });
    await page.goto('/');
    const artwork = page.getByTestId('launch-artwork');
    await expect(page.getByRole('button', { name: 'Call klnk', exact: true })).toBeVisible();
    if (reducedMotion === 'reduce') {
      expect(await artwork.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
      expect(
        await page.evaluate(
          () => (window as unknown as { __klnkArtworkStarts: string[] }).__klnkArtworkStarts,
        ),
      ).toEqual([]);
    } else {
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __klnkArtworkStarts: string[] }).__klnkArtworkStarts.length,
          ),
        )
        .toBe(1);
      expect(
        await artwork.evaluate((node) => ({
          duration: getComputedStyle(node).animationDuration,
          iterations: getComputedStyle(node).animationIterationCount,
        })),
      ).toEqual({ duration: '0.28s', iterations: '1' });
      await expect
        .poll(() =>
          artwork.evaluate((node) =>
            node.getAnimations().some((animation) => animation.playState === 'running'),
          ),
        )
        .toBe(false);
      // A preference change removes translation/scale without remounting the action or losing focus.
      const call = page.getByRole('button', { name: 'Call klnk', exact: true });
      await call.focus();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect
        .poll(() => call.evaluate((node) => getComputedStyle(node.parentElement!).transform))
        .toBe('none');
      await expect(call).toBeFocused();
    }
    await expectNoCapture(page);
  });
}
