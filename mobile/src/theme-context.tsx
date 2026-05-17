// theme-context.tsx — runtime light/dark theming for the session
// surfaces. The Claude Design prototype switched data-theme on a host
// element; here a React context holds the active mode and every
// component derives its palette from it via useTheme()/useThemeStyles.
//
// Default mode is "light" — the prototype's TWEAK_DEFAULTS.theme. The
// design exposed a sun/moon toggle in the Home topbar; mobile has no
// Home screen yet, so ThemeToggle lives in the session TopBar instead.

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { theme as lightTheme, darkTheme, type Theme } from "@/theme";

export type ThemeMode = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initial = "light",
}: {
  children: React.ReactNode;
  initial?: ThemeMode;
}) {
  const [mode, setMode] = useState<ThemeMode>(initial);
  const toggle = useCallback(
    () => setMode((m) => (m === "dark" ? "light" : "dark")),
    [],
  );
  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      toggle,
      theme: mode === "dark" ? darkTheme : lightTheme,
    }),
    [mode, toggle],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // No provider mounted (e.g. an isolated screen). Fall back to the
    // prototype default so components still render.
    return {
      theme: lightTheme,
      mode: "light",
      toggle: () => {},
      setMode: () => {},
    };
  }
  return ctx;
}

/** Active palette object. */
export function useTheme(): Theme {
  return useThemeContext().theme;
}

/** Active mode + the toggle, for the sun/moon control. */
export function useThemeMode(): { mode: ThemeMode; toggle: () => void } {
  const { mode, toggle } = useThemeContext();
  return { mode, toggle };
}

/**
 * Memoize a per-theme StyleSheet. `factory` builds (and StyleSheet
 * .create()s) the sheet from a palette; it must be a stable (module-
 * level) reference. The sheet is rebuilt only when the palette changes.
 */
export function useThemeStyles<T>(factory: (t: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}
