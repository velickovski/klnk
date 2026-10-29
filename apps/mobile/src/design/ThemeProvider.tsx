import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, useColorScheme, useWindowDimensions } from 'react-native';
import { createUIStyles } from './styles';
import { legacyColors, semanticColors } from './tokens';
const baseSemantic = semanticColors('light'),
  baseColors = legacyColors(baseSemantic);
const fallback = {
  theme: 'light' as 'light' | 'dark',
  semantic: baseSemantic,
  colors: baseColors,
  styles: createUIStyles(baseColors),
  reducedMotion: false,
  reducedTransparency: false,
  highContrast: false,
};
const DesignContext = createContext(fallback);
const webPreference = (query: string) =>
  Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
/** A fixed artwork surface can opt into its matching foreground palette. */
export function ThemeProvider({
  children,
  colorScheme,
}: {
  children: React.ReactNode;
  colorScheme?: 'light' | 'dark';
}) {
  const systemScheme = useColorScheme();
  const scheme: 'light' | 'dark' = colorScheme ?? (systemScheme === 'dark' ? 'dark' : 'light'),
    { width } = useWindowDimensions();
  const [reducedMotion, setReducedMotion] = useState(() =>
      webPreference('(prefers-reduced-motion: reduce)'),
    ),
    [reducedTransparency, setReducedTransparency] = useState(() =>
      webPreference('(prefers-reduced-transparency: reduce)'),
    ),
    [highContrast, setHighContrast] = useState(() => webPreference('(prefers-contrast: more)'));
  useEffect(() => {
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      // RN Web keys AccessibilityInfo listeners by a callback's string form.
      // Nested theme providers can therefore remove another provider's listener.
      // Own each browser subscription and its exact cleanup independently.
      const preferences = [
        ['(prefers-reduced-motion: reduce)', setReducedMotion],
        ['(prefers-reduced-transparency: reduce)', setReducedTransparency],
        ['(prefers-contrast: more)', setHighContrast],
      ] as const;
      const cleanups = preferences.map(([query, set]) => {
        const media = window.matchMedia(query);
        const changed = () => set(media.matches);
        changed();
        media.addEventListener('change', changed);
        return () => media.removeEventListener('change', changed);
      });
      return () => cleanups.forEach((cleanup) => cleanup());
    }
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (v) => {
        if (alive) setReducedMotion(v);
      },
      () => {},
    );
    AccessibilityInfo.isReduceTransparencyEnabled?.().then(
      (v) => {
        if (alive) setReducedTransparency(v);
      },
      () => {},
    );
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion),
      transparency = AccessibilityInfo.addEventListener(
        'reduceTransparencyChanged',
        setReducedTransparency,
      );
    return () => {
      alive = false;
      motion.remove();
      transparency.remove();
    };
  }, []);
  const value = useMemo(() => {
    const semantic = semanticColors(scheme, highContrast),
      colors = legacyColors(semantic);
    return {
      theme: scheme,
      semantic,
      colors,
      styles: createUIStyles(colors, width < 375 ? 16 : width > 600 ? 32 : 24),
      reducedMotion,
      reducedTransparency,
      highContrast,
    };
  }, [scheme, width, reducedMotion, reducedTransparency, highContrast]);
  return <DesignContext.Provider value={value}>{children}</DesignContext.Provider>;
}
export const useDesign = () => useContext(DesignContext);
export const useUI = useDesign;
