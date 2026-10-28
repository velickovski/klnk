import { expect, type Page } from '@playwright/test';

export const apiOrigin = process.env.KLNK_E2E_API_URL ?? 'http://127.0.0.1:4102';
export const apiPath = (path: string) => `${apiOrigin}${path}`;

/** Fixture accounts are created by the actual local API; no provider is contacted. */
export async function enterSimulation(page: Page) {
  await page.goto('/?workspace=1&legacy=1');
  await page.getByRole('button', { name: 'Try the simulation', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
}

export async function chooseType(page: Page) {
  await page.getByRole('radio', { name: 'Type', exact: true }).click();
  return page.getByRole('textbox', { name: 'Message to klnk', exact: true });
}

export async function settingsProfile(page: Page) {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  return page.getByRole('textbox', { name: 'Your name', exact: true });
}

export async function installNoCaptureProbe(page: Page) {
  await page.addInitScript(() => {
    const state = { attempts: 0 };
    Object.defineProperty(window, '__klnkQaMedia', { value: state });
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => {
        state.attempts++;
        throw new DOMException('Fictional QA permission denial', 'NotAllowedError');
      };
    }
    // Text journeys do not assess OS/device playback or use the workstation speaker.
    if (window.speechSynthesis) {
      window.speechSynthesis.speak = () => {};
      window.speechSynthesis.cancel = () => {};
    }
  });
}

export async function expectNoCapture(page: Page) {
  expect(
    await page.evaluate(
      () => (window as unknown as { __klnkQaMedia: { attempts: number } }).__klnkQaMedia.attempts,
    ),
  ).toBe(0);
}

/** Override resolved px text, since changing root rem does not enlarge RN Web text. */
export async function enlargeTextAndSpacing(page: Page, paragraphs: string[] = []) {
  await page.evaluate((paragraphs) => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
      (element) =>
        !element.closest('[aria-hidden="true"]') &&
        (element.matches('input,textarea,select') ||
          Array.from(element.childNodes).some(
            (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
          )),
    );
    // Capture all natural sizes first to avoid compounding inherited sizes.
    const sizes = targets.map((element) =>
      Number(element.dataset.klnkQaBaseFont ?? parseFloat(getComputedStyle(element).fontSize)),
    );
    targets.forEach((element, index) => {
      element.dataset.klnkQaBaseFont = String(sizes[index]);
      element.style.fontSize = `${sizes[index] * 2}px`;
      element.style.lineHeight = '1.5';
      element.style.letterSpacing = '.12em';
      element.style.wordSpacing = '.16em';
      // Button/tab labels and decorative icon glyphs are not paragraphs.
      if (paragraphs.includes(element.textContent?.trim() ?? ''))
        element.style.marginBottom = '2em';
    });
  }, paragraphs);
}
