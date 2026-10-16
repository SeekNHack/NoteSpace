/**
 * Site appearance: curated presets plus a few explicit overrides. Presets only choose tokens
 * that are safe in both light and dark schemes (accent hue, type, width, corner radius); body
 * text and background colors always come from the design system, so contrast stays WCAG AA.
 */
export const fonts = {
  system: 'system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif',
  humanist: '"Seravek","Gill Sans Nova",Ubuntu,Calibri,"DejaVu Sans",source-sans-pro,sans-serif',
  serif: '"Iowan Old Style","Palatino Linotype","URW Palladio L",P052,Georgia,serif',
  mono: 'ui-monospace,"Cascadia Code","Source Code Pro",Menlo,Consolas,"DejaVu Sans Mono",monospace',
} as const;
export type FontId = keyof typeof fonts;
export const widths = { narrow: '680px', normal: '760px', wide: '920px' } as const;
export type WidthId = keyof typeof widths;

export interface ThemePreset {
  id: string;
  label: string;
  description: string;
  accent: string;
  font: FontId;
  width: WidthId;
  radius: number;
}
export const presets: ThemePreset[] = [
  {
    id: 'default',
    label: 'Studio',
    description: 'Clean sans-serif, blue accent',
    accent: '#4f87ff',
    font: 'system',
    width: 'normal',
    radius: 6,
  },
  {
    id: 'ocean',
    label: 'Ocean',
    description: 'Teal accent, roomy layout',
    accent: '#0e9fb8',
    font: 'humanist',
    width: 'wide',
    radius: 8,
  },
  {
    id: 'forest',
    label: 'Forest',
    description: 'Green accent, humanist type',
    accent: '#2f9e58',
    font: 'humanist',
    width: 'normal',
    radius: 6,
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Serif reading type, narrow measure',
    accent: '#b4572d',
    font: 'serif',
    width: 'narrow',
    radius: 2,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Monospace, square corners',
    accent: '#7c6cf0',
    font: 'mono',
    width: 'wide',
    radius: 0,
  },
  {
    id: 'rose',
    label: 'Rose',
    description: 'Warm pink accent, soft corners',
    accent: '#d6457a',
    font: 'system',
    width: 'normal',
    radius: 10,
  },
];

export interface Appearance {
  theme: 'system' | 'light' | 'dark';
  accent: string;
  preset?: string;
  font?: FontId;
  width?: WidthId;
}

/** Resolved values: explicit fields win over the preset, which wins over the defaults. */
export function resolveAppearance(appearance?: Appearance) {
  const preset = presets.find((p) => p.id === appearance?.preset) || presets[0];
  return {
    theme: appearance?.theme || 'system',
    accent:
      appearance?.accent && /^#[0-9a-f]{6}$/i.test(appearance.accent)
        ? appearance.accent
        : preset.accent,
    font: appearance?.font && appearance.font in fonts ? appearance.font : preset.font,
    width: appearance?.width && appearance.width in widths ? appearance.width : preset.width,
    radius: preset.radius,
  };
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const luminance = (h: string) => {
  const [r, g, b] = hex(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** Mixes an accent toward black or white until links reach 4.5:1 on the given background. */
export function readableAccent(accent: string, background: string): string {
  const target = luminance(background) > 0.5 ? [0, 0, 0] : [1, 1, 1];
  const base = hex(accent);
  for (let t = 0; t <= 1; t += 0.05) {
    const mixed = base.map((c, i) => Math.round((c + (target[i] - c) * t) * 255));
    const value = `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    if (contrast(value, background) >= 4.5) return value;
  }
  return luminance(background) > 0.5 ? '#000000' : '#ffffff';
}

/** CSS for exported sites. Link colors are adjusted per scheme so they stay readable. */
export function appearanceCss(appearance?: Appearance): string {
  const a = resolveAppearance(appearance);
  const light = readableAccent(a.accent, '#ffffff'),
    dark = readableAccent(a.accent, '#1e1e1e');
  const scheme = a.theme === 'system' ? '' : `color-scheme:${a.theme};`;
  return `:root{${scheme}--ws-accent:light-dark(${light},${dark});--ws-font:${fonts[a.font]};--ws-doc-width:${widths[a.width]};--ws-r1:${Math.round(a.radius * 0.67)}px;--ws-r2:${a.radius}px;--ws-r3:${Math.round(a.radius * 1.5)}px}`;
}
