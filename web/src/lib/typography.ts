import type { Density, FontFamily, TypographySettings } from "../../../src/shared/types";
import { DEFAULT_TYPOGRAPHY } from "../../../src/shared/types";

const SANS_FAMILIES: Record<FontFamily, string> = {
  inter: `"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`,
  plex: `"IBM Plex Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`,
  system: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`,
};

const DENSITY: Record<Density, { py: number; leading: number }> = {
  compact: { py: -10, leading: 1.5 },
  comfortable: { py: 0, leading: 1.6 },
  spacious: { py: 14, leading: 1.8 },
};

/** Apply typography presets as CSS variables on <html> (mirrors lib/accent.ts). */
export function applyTypography(input: Partial<TypographySettings> | undefined) {
  if (typeof document === "undefined") return;
  const t: TypographySettings = { ...DEFAULT_TYPOGRAPHY, ...input };
  const style = document.documentElement.style;
  const density = DENSITY[t.density];

  style.setProperty("--font-sans", SANS_FAMILIES[t.fontFamily]);
  style.setProperty("--font-size-base", `${t.fontSize}px`);
  style.setProperty("--font-size-prose", `${t.fontSize + 1}px`);
  style.setProperty("--font-serif", `"Newsreader Variable", Georgia, "Times New Roman", serif`);
  style.setProperty("--density-py", `${density.py}px`);
  style.setProperty("--density-leading", String(density.leading));
  style.setProperty("--prose-leading", t.density === "compact" ? "1.5" : t.density === "spacious" ? "1.8" : "1.65");
  style.setProperty("--liga", t.ligatures ? "normal" : "none");
  document.documentElement.classList.toggle("prose-serif", t.serifProse);
}
