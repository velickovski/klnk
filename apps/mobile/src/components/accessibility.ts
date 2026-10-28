import { Platform, type AccessibilityState } from 'react-native';

/** This RN Web version does not map accessibilityState; retain native state too. */
export function a11yState(state: AccessibilityState, platform = Platform.OS) {
  return {
    accessibilityState: state,
    ...(platform === 'web'
      ? {
          'aria-busy': state.busy,
          'aria-checked': state.checked,
          'aria-disabled': state.disabled,
          'aria-expanded': state.expanded,
          'aria-selected': state.selected,
        }
      : {}),
  };
}
