// The page is lit by the colour the user holds. A dark colour gives almost no light on the
// dark page, so it is replaced by a neutral one.

export const NEUTRAL_GLOW = '#8a93c4';

// Below this brightness (0-255) a colour does not light the page
export const DARK_LUMA = 60;

// Text on a light background
export const INK = '#0c1030';

const HEX = /^#([0-9a-f]{6})$/i;

// Perceived brightness of a #RRGGBB colour, 0 (black) to 255 (white); null for anything else
export function luma(hex: string): number | null {
  const match = HEX.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
}

// The colour the page is lit with while `hex` is selected
export function glowColor(hex: string | undefined): string {
  if (!hex) return NEUTRAL_GLOW;
  const value = luma(hex);
  return value === null || value < DARK_LUMA ? NEUTRAL_GLOW : hex.toLowerCase();
}

// Text colour that stays readable on a `hex` background
export function readableOn(hex: string): string {
  return (luma(hex) ?? 0) > 150 ? INK : '#ffffff';
}

// Outline for a small colour dot, so its edge shows on any background: white around dark
// colours, dark around light ones
export function outlineFor(hex: string): string {
  return (luma(hex) ?? 0) < 128 ? '#ffffff' : INK;
}
