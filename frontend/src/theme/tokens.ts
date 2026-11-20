/** Design tokens (mirrors the CSS variables in styles/base.css; use these where CSS can't, e.g. Leaflet). */
export const colors = {
  bg: '#0b1118',
  panel: '#111a23',
  panelRaised: '#17232e',
  line: '#24313d',
  text: '#e8edf1',
  muted: '#8593a0',
  soft: '#b4bec7',
  accent: '#5ed6ff', // rain blue
  onAccent: '#06101a',
  green: '#5ce0a0',
  yellow: '#ffca68',
  red: '#ff667c',
  neutral: '#8593a0',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Gurugram centre, used as the default map view. */
export const GURUGRAM_CENTER: [number, number] = [28.4595, 77.0266];
