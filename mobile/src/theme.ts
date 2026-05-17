// Design tokens — RN port of the Claude Design bundle's styles.css :root
// (light) and [data-theme="dark"] blocks, plus the teal accent palette
// from app.jsx ACCENT_PALETTES['#0e7490']. CSS color-mix(in oklab, …)
// values are resolved to concrete colors here since React Native has no
// color-mix; ratios match the source (e.g. fg-soft = fg @ 70% alpha).
//
// The interactive prototype defaults to data-theme="light" + the teal
// accent, so the session screens use `theme` (light). `darkTheme` mirrors
// the dark block for parity if a future surface needs it.

export interface Theme {
  bg: string;
  bgDeep: string;
  fg: string;
  fgSoft: string;
  fgFaint: string;
  fgGhost: string;
  surface: string;
  surfaceMute: string;
  border: string;
  borderSoft: string;

  accent: string;
  accentFg: string;
  accentSoft: string;
  accentDeep: string;

  waveRise: string;
  wavePeak: string;
  waveFall: string;

  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
}

// fg = #0b1f33 → (11,31,51). The fg-* tokens are that color at reduced
// alpha (color-mix(in oklab, fg N%, transparent)); RN takes rgba directly.
export const theme: Theme = {
  bg: "#f5f8fb",
  bgDeep: "#eaf1f8",
  fg: "#0b1f33",
  fgSoft: "rgba(11,31,51,0.70)",
  fgFaint: "rgba(11,31,51,0.45)",
  fgGhost: "rgba(11,31,51,0.22)",
  surface: "#ffffff",
  surfaceMute: "#eef3f9",
  border: "#d6e1ec",
  borderSoft: "rgba(214,225,236,0.60)",

  accent: "#0e7490",
  accentFg: "#ffffff",
  accentSoft: "#cffafe",
  // accent @ 70% + black @ 30% ≈ (10,81,101)
  accentDeep: "#0a5165",

  waveRise: "#38bdf8",
  wavePeak: "#0284c7",
  waveFall: "#67e8f9",

  warn: "#b45309",
  warnSoft: "#fef3c7",
  danger: "#b91c1c",
  dangerSoft: "#fee2e2",
};

// [data-theme="dark"] block + dark accent (#22d3ee) from ACCENT_PALETTES.
export const darkTheme: Theme = {
  bg: "#05131f",
  bgDeep: "#03101a",
  fg: "#e6f1fa",
  fgSoft: "rgba(230,241,250,0.70)",
  fgFaint: "rgba(230,241,250,0.50)",
  fgGhost: "rgba(230,241,250,0.25)",
  surface: "#0c1f30",
  surfaceMute: "#0a1a28",
  border: "#1e3a52",
  borderSoft: "rgba(30,58,82,0.55)",

  accent: "#22d3ee",
  accentFg: "#05131f",
  accentSoft: "#164e63",
  accentDeep: "#0a5165",

  waveRise: "#38bdf8",
  wavePeak: "#0ea5e9",
  waveFall: "#67e8f9",

  warn: "#fbbf24",
  warnSoft: "#3b2e10",
  danger: "#f87171",
  dangerSoft: "#3b1414",
};

// --radius-{sm,md,lg,xl}. RN uses `borderCurve: "continuous"` alongside
// these to approximate the iOS-style superellipse the CSS implies.
export const radius = { sm: 10, md: 16, lg: 24, xl: 32 } as const;

// Type scale lifted from styles.css. Geist is the design font; the app
// has not bundled it, so these fall back to the system UI font. letter
// spacing values are converted from em to absolute points at each size.
export const type = {
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: 1.9, // 0.18em
    textTransform: "uppercase" as const,
    fontWeight: "500" as const,
  },
  display: {
    fontSize: 26,
    lineHeight: 29,
    letterSpacing: -0.73, // -0.028em
    fontWeight: "600" as const,
  },
  displayBig: {
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -1.02, // -0.03em
    fontWeight: "600" as const,
  },
  section: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3, // -0.015em
    fontWeight: "600" as const,
  },
  lede: { fontSize: 15, lineHeight: 22.5, fontWeight: "400" as const },
  hint: { fontSize: 12, lineHeight: 17.4, fontWeight: "400" as const },
  crumb: {
    fontSize: 10.5,
    letterSpacing: 1.9,
    textTransform: "uppercase" as const,
    fontWeight: "500" as const,
  },
} as const;

export const shadowSoft = {
  shadowColor: "#0b1f33",
  shadowOpacity: 0.12,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 6,
} as const;
