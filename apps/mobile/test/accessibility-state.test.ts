import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
import { a11yState } from '../src/components/accessibility';
describe('equivalent web and native control state', () => {
  it('exposes both true and false states to the browser accessibility tree', () => {
    expect(
      a11yState({ selected: true, checked: false, expanded: false, disabled: true, busy: true }),
    ).toMatchObject({
      'aria-selected': true,
      'aria-checked': false,
      'aria-expanded': false,
      'aria-disabled': true,
      'aria-busy': true,
    });
  });
  it('retains native semantics without web attributes', () => {
    expect(a11yState({ checked: 'mixed', selected: false }, 'ios')).toEqual({
      accessibilityState: { checked: 'mixed', selected: false },
    });
  });
});
