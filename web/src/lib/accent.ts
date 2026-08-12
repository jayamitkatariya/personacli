/**
 * Custom color schemes. An accent hex is expanded into a full Tailwind-style
 * blue scale (the app's accent hue) plus a rotated violet scale and gradient
 * stops for the aura/wordmark, all injected as CSS variables on <html>.
 * Because Tailwind v4 utilities compile to `var(--color-blue-*)`, overriding
 * those variables re-themes the whole UI without touching component classes.
 */

export const DEFAULT_ACCENT = "#2563eb";

export interface AccentPreset {
  id: string;
  label: string;
  color: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "default", label: "Default blue", color: "#2563eb" },
  { id: "ocean", label: "Ocean", color: "#0891b2" },
  { id: "forest", label: "Forest", color: "#059669" },
  { id: "sunset", label: "Sunset", color: "#ea580c" },
  { id: "violet", label: "Violet", color: "#7c3aed" },
  { id: "rose", label: "Rose", color: "#db2777" },
];

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidAccent(value: string): boolean {
  return ACCENT_RE.test(value);
}

/** Normalize to a lowercase 6-digit hex, falling back to the default accent. */
export function normalizeAccent(value: string): string {
  return isValidAccent(value) ? value.toLowerCase() : DEFAULT_ACCENT;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: Rgb): string {
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Blend `a` toward `b` by `p` (0 = a, 1 = b). */
function mix(a: Rgb, b: Rgb, p: number): Rgb {
  return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const hh = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}

/** Rotate a hex's hue by `deg` (used to derive violet/rose accents for gradients). */
function rotateHue(hex: string, deg: number): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([h + deg, s, l]));
}

/** Tailwind-shaped 50→950 scale for a base color. */
function scaleFor(base: string): string[] {
  const rgb = hexToRgb(base);
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];
  // (shade, fraction toward black)
  const steps: [string, number][] = [
    ["50", 0], ["100", 0.02], ["200", 0.06], ["300", 0.12], ["400", 0.22],
    ["500", 0.32], ["600", 0.42], ["700", 0.52], ["800", 0.62], ["900", 0.72],
    ["950", 0.8],
  ];
  const out: string[] = [];
  for (const [shade, frac] of steps) {
    const mixed = mix(mix(rgb, white, shade === "50" ? 0.9 : shade === "100" ? 0.82 : shade === "200" ? 0.68 : shade === "300" ? 0.5 : shade === "400" ? 0.28 : 0), black, frac);
    out.push(rgbToHex(mixed));
  }
  return out;
}

function hexToRgbString(hex: string): string {
  return hexToRgb(hex).join(", ");
}

/**
 * Inject the accent's derived palette as CSS variables on <html>. Safe to
 * call repeatedly (e.g. while dragging a color picker).
 */
export function applyAccent(hex: string) {
  const accent = normalizeAccent(hex);
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;

  const blue = scaleFor(accent);
  for (let i = 0; i < blue.length; i++) {
    style.setProperty(`--color-blue-${["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"][i]}`, blue[i] ?? accent);
  }

  // Violet is the accent hue shifted +30° — keeps gradients and secondary
  // accents (focus rings, "Switch workspace" icon…) harmonious with any color.
  const violet = scaleFor(rotateHue(accent, 30));
  for (let i = 0; i < violet.length; i++) {
    style.setProperty(`--color-violet-${["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"][i]}`, violet[i] ?? accent);
  }

  // Gradient stops for the wordmark / CTA / chat bubble (analogous hues, all
  // at 600-level depth — same as the original palette for the default accent).
  const g1 = hexToRgb(accent);
  const g2 = hexToRgb(rotateHue(accent, 30));
  const g3 = hexToRgb(rotateHue(accent, 55));
  const g4 = hexToRgb(rotateHue(accent, 75));
  style.setProperty("--g1", rgbToHex(g1));
  style.setProperty("--g2", rgbToHex(g2));
  style.setProperty("--g3", rgbToHex(g3));
  style.setProperty("--g4", rgbToHex(g4));

  // Aura ring stops + raw accent rgb (for rgba() usages like caret glow).
  style.setProperty("--aura-1", hexToRgbString(rgbToHex(g1)));
  style.setProperty("--aura-2", hexToRgbString(rgbToHex(g2)));
  style.setProperty("--aura-3", hexToRgbString(rgbToHex(g3)));
  style.setProperty("--aura-4", hexToRgbString(rgbToHex(g4)));
  style.setProperty("--accent-rgb", hexToRgbString(accent));
}
