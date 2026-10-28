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
  const [reducedMotion, setReducedMotion] = useState(false),
    [reducedTransparency, setReducedTransparency] = useState(false),
    [highContrast, setHighContrast] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReducedMotion(v);
    });
    AccessibilityInfo.isReduceTransparencyEnabled?.().then((v) => {
      if (alive) setReducedTransparency(v);
    });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion),
      transparency = AccessibilityInfo.addEventListener(
        'reduceTransparencyChanged',
        setReducedTransparency,
      );
    const media =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.matchMedia('(prefers-contrast: more)')
        : undefined;
    const contrast = () => setHighContrast(media?.matches ?? false);
    contrast();
    media?.addEventListener('change', contrast);
    return () => {
      alive = false;
      motion.remove();
      transparency.remove();
      media?.removeEventListener('change', contrast);
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
