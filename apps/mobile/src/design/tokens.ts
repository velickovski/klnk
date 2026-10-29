/** Opaque semantic colors. Brand composition stays fixed; workspace follows system appearance. */
export const brand = {
  navy: '#191D3A',
  lavender: '#ECEEFC',
  ink: '#202440',
  muted: '#414864',
  cream: '#FFFDF9',
  onNavyMuted: '#C2C6E3',
  coral: '#FF899A',
  coralPressed: '#FFC2CC',
  edge: '#717B9E',
  artworkSurface: '#252B4D',
} as const;
/** Short, finite motion; decorative entrance never indicates microphone activity. */
export const motion = { entranceMs: 280, pressMs: 120 } as const;
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  screen: 24,
  section: 32,
  hero: 40,
  large: 48,
} as const;
export const radii = { control: 16, group: 24, sheet: 32, capsule: 999 } as const;
export const typeRoles = {
  hero: { fontSize: 34, lineHeight: 40, fontWeight: '600' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  section: { fontSize: 21, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 25, fontWeight: '400' },
  action: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  supporting: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
} as const;
const light = {
  background: brand.lavender as string,
  surface: '#FFFFFF',
  surfaceRaised: '#E9EDF5',
  text: '#151924',
  textSecondary: '#414864',
  accent: '#203D87',
  onAccent: '#FFFFFF',
  action: brand.coral,
  onAction: brand.navy,
  actionPressed: brand.coralPressed,
  borderStrong: '#66738A',
  border: '#ADB4D0',
  success: '#135437',
  warning: '#704200',
  danger: '#8E2035',
  successSurface: '#E5F1EB',
  warningSurface: '#FFF0D7',
  dangerSurface: '#FBE9EE',
  focus: '#202440',
};
const dark = {
  background: '#0E1228',
  surface: brand.navy,
  surfaceRaised: '#252B47',
  text: brand.cream,
  textSecondary: brand.onNavyMuted,
  accent: '#FFD2DA',
  onAccent: brand.navy,
  action: brand.coral,
  onAction: brand.navy,
  actionPressed: brand.coralPressed,
  borderStrong: '#8893B2',
  border: '#69768B',
  success: '#A6DEC4',
  warning: '#FFD699',
  danger: '#FFB4BE',
  successSurface: '#152D28',
  warningSurface: '#34281A',
  dangerSurface: '#3B2030',
  focus: '#FFFDF9',
};
export type SemanticColors = typeof light;
export function semanticColors(scheme: 'light' | 'dark', highContrast = false): SemanticColors {
  const colors = scheme === 'dark' ? dark : light;
  return highContrast ? { ...colors, border: colors.borderStrong } : colors;
}
/** Immutable compatibility aliases; resolve them through context. */
export function legacyColors(colors: SemanticColors) {
  return {
    ...colors,
    paper: colors.background,
    white: colors.surface,
    ink: colors.text,
    muted: colors.textSecondary,
    line: colors.borderStrong,
    green: colors.accent,
    lightGreen: colors.surfaceRaised,
    sage: colors.borderStrong,
    amber: colors.warning,
    lightAmber: colors.warningSurface,
    red: colors.danger,
    lightRed: colors.dangerSurface,
    blue: colors.accent,
    lightBlue: colors.surfaceRaised,
  };
}
export type UIColors = ReturnType<typeof legacyColors>;
