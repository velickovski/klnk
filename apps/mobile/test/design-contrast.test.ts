import { describe, expect, it } from 'vitest';
import { brand, semanticColors } from '../src/design/tokens';

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('specified opaque design color pairs', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const c = semanticColors(scheme);
    for (const background of [c.background, c.surface, c.surfaceRaised]) {
      it(`${scheme}: body and supporting text reach 7:1 on ${background}`, () => {
        expect(contrast(c.text, background)).toBeGreaterThanOrEqual(7);
        expect(contrast(c.textSecondary, background)).toBeGreaterThanOrEqual(7);
      });
      it(`${scheme}: control border reaches 3:1 on ${background}`, () =>
        expect(contrast(c.borderStrong, background)).toBeGreaterThanOrEqual(3));
    }
    it(`${scheme}: action, status and error text pairs reach 7:1`, () => {
      for (const [text, background] of [
        [c.onAction, c.action],
        [c.success, c.successSurface],
        [c.warning, c.warningSurface],
        [c.danger, c.dangerSurface],
        [c.accent, c.surfaceRaised],
      ])
        expect(contrast(text, background)).toBeGreaterThanOrEqual(7);
    });
  }
  it('fixed opening text pairs reach 7:1', () => {
    for (const [text, background] of [
      [brand.cream, brand.navy],
      [brand.onNavyMuted, brand.navy],
      [brand.ink, brand.lavender],
      [brand.muted, brand.lavender],
      [brand.navy, brand.coral],
    ])
      expect(contrast(text, background)).toBeGreaterThanOrEqual(7);
  });
});
