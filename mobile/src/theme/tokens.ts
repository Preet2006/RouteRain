/** Design tokens for RouteRain Mobile (dark theme, one accent colour plus the three tier colours). */

export const colors = {
  background: '#0B1220',
  surface: '#121B2E',
  surfaceRaised: '#1A2540',
  border: '#26334F',
  text: '#E8EEF9',
  textMuted: '#9AA8C4',
  accent: '#38A3F5', // rain blue
  onAccent: '#06101F',
  good: '#2EBD6B',
  warn: '#F2B01E',
  danger: '#EF4B4B',
  neutral: '#6B7690',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

/** Minimum touch target (dp) from MOBILE_APP_PLAN.md section 3. */
export const touchTarget = 48;

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 16, fontWeight: '400' as const, color: colors.text },
  caption: { fontSize: 13, fontWeight: '400' as const, color: colors.textMuted },
} as const;
