// ui.tsx — shared primitives ported from the design bundle's styles.css
// + screens.jsx. Light theme (the prototype's default). Used by the
// session screens; kept dependency-light (no expo-linear-gradient — the
// one gradient, the intensity fill, is approximated with the accent).

import React, { useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { radius, type, shadowSoft, type Theme } from "@/theme";
import { useTheme, useThemeMode, useThemeStyles } from "@/theme-context";

// ─── Screen scaffold (.screen + .screen-body) ──────────────────

export function ScreenScaffold({ children }: { children: React.ReactNode }) {
  const styles = useThemeStyles(makeStyles);
  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      {children}
    </SafeAreaView>
  );
}

export function ScreenBody({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemeStyles(makeStyles);
  return <View style={[styles.screenBody, style]}>{children}</View>;
}

// ─── Theme toggle (.theme-toggle — sun/moon, design Home topbar) ─

export function ThemeToggle() {
  const theme = useTheme();
  const { mode, toggle } = useThemeMode();
  const styles = useThemeStyles(makeStyles);
  const isDark = mode === "dark";
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        isDark ? "Switch to light mode" : "Switch to dark mode"
      }
      style={({ pressed }) => [
        styles.themeToggle,
        pressed && { transform: [{ scale: 0.94 }] },
      ]}
    >
      <Svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke={theme.fgSoft}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {isDark ? (
          <>
            <Circle cx={12} cy={12} r={4} />
            <Path d="M12 2v2" />
            <Path d="M12 20v2" />
            <Path d="m4.93 4.93 1.41 1.41" />
            <Path d="m17.66 17.66 1.41 1.41" />
            <Path d="M2 12h2" />
            <Path d="M20 12h2" />
            <Path d="m4.93 19.07 1.41-1.41" />
            <Path d="m17.66 6.34 1.41-1.41" />
          </>
        ) : (
          <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        )}
      </Svg>
    </Pressable>
  );
}

// ─── Topbar (.topbar / .back-link / .crumb) ────────────────────

export function TopBar({
  crumb,
  onBack,
  right,
}: {
  crumb: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const styles = useThemeStyles(makeStyles);
  return (
    <View style={styles.topbar}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} style={styles.backLink}>
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      ) : (
        <ThemeToggle />
      )}
      <Text style={styles.crumb}>{crumb}</Text>
      <View style={styles.topbarRight}>
        {right}
        {onBack ? <ThemeToggle /> : null}
      </View>
    </View>
  );
}

// ─── Typography ────────────────────────────────────────────────

export function Eyebrow({
  children,
  accent,
  style,
}: {
  children: React.ReactNode;
  accent?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  const styles = useThemeStyles(makeStyles);
  return (
    <Text
      style={[
        styles.eyebrow,
        accent && { color: theme.accent },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Display({
  children,
  big,
  style,
}: {
  children: React.ReactNode;
  big?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const styles = useThemeStyles(makeStyles);
  return (
    <Text style={[big ? styles.displayBig : styles.display, style]}>
      {children}
    </Text>
  );
}

export function Lede({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const styles = useThemeStyles(makeStyles);
  return <Text style={[styles.lede, style]}>{children}</Text>;
}

export function Hint({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const styles = useThemeStyles(makeStyles);
  return <Text style={[styles.hint, style]}>{children}</Text>;
}

// ─── Buttons (.btn .primary / .ghost) ──────────────────────────

export function PrimaryButton({
  label,
  onPress,
  disabled,
  trailing,
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  trailing?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemeStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        styles.btnPrimary,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
        style,
      ]}
    >
      <Text style={styles.btnPrimaryText}>
        {label}
        {trailing ? `  ${trailing}` : ""}
      </Text>
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemeStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.btnGhost, pressed && { opacity: 0.6 }, style]}
    >
      <Text style={styles.btnGhostText}>{label}</Text>
    </Pressable>
  );
}

// ─── Chip (.chip / .chip.list) ─────────────────────────────────

export function Chip({
  label,
  pressed,
  onPress,
  list,
  small,
}: {
  label: string;
  pressed?: boolean;
  onPress?: () => void;
  /** .chip.list — left-aligned full-width row. */
  list?: boolean;
  small?: boolean;
}) {
  const theme = useTheme();
  const styles = useThemeStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed: tap }) => [
        styles.chip,
        list && styles.chipList,
        small && styles.chipSmall,
        pressed && (list ? styles.chipListOn : styles.chipOn),
        tap && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          list && styles.chipTextList,
          small && styles.chipTextSmall,
          pressed && { color: list ? theme.accent : theme.accentFg },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Card (.card / .card.flush) ────────────────────────────────

export function Card({
  children,
  flush,
  tone,
  style,
}: {
  children: React.ReactNode;
  flush?: boolean;
  /** "soft" → accent-tinted (medication-aware ack card). */
  tone?: "default" | "soft" | "mute";
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemeStyles(makeStyles);
  return (
    <View
      style={[
        styles.card,
        flush && styles.cardFlush,
        tone === "soft" && styles.cardSoft,
        tone === "mute" && styles.cardMute,
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ─── Pill (.pill) ──────────────────────────────────────────────

export function Pill({ children }: { children: React.ReactNode }) {
  const styles = useThemeStyles(makeStyles);
  return (
    <View style={styles.pill}>
      <View style={styles.pillDot} />
      <Text style={styles.pillText}>{children}</Text>
    </View>
  );
}

// ─── IntensitySlider (.intensity, screens.jsx IntensitySlider) ─
//
// Big number readout, tall track with integer ticks, draggable thumb,
// snaps 1–10. Drag handled with PanResponder against the measured
// track width.

export function IntensitySlider({
  value,
  touched,
  onChange,
  big,
}: {
  value: number;
  touched: boolean;
  onChange: (n: number) => void;
  big?: boolean;
}) {
  const styles = useThemeStyles(makeStyles);
  const MIN = 1;
  const MAX = 10;
  const widthRef = useRef(0);
  const [, force] = useState(0);

  function valueAtX(x: number): number {
    const w = widthRef.current || 1;
    const ratio = Math.max(0, Math.min(1, x / w));
    return Math.round(MIN + ratio * (MAX - MIN));
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const v = valueAtX(e.nativeEvent.locationX);
        onChangeRef.current(v);
      },
      onPanResponderMove: (e) => {
        const v = valueAtX(e.nativeEvent.locationX);
        onChangeRef.current(v);
      },
    }),
  ).current;

  // Keep the latest onChange reachable from the stable PanResponder.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function onTrackLayout(e: LayoutChangeEvent) {
    widthRef.current = e.nativeEvent.layout.width;
    force((n) => n + 1);
  }

  const pct = (value - MIN) / (MAX - MIN); // 0..1
  const trackW = widthRef.current;

  return (
    <View style={styles.intensity}>
      <View style={styles.intensityReadout}>
        <Text
          style={[
            big ? styles.intensityNumBig : styles.intensityNum,
            { opacity: touched ? 1 : 0.25 },
          ]}
        >
          {value}
          <Text style={styles.intensityUnit}> /10</Text>
        </Text>
      </View>

      <View
        style={[styles.intensityTrack, big && styles.intensityTrackBig]}
        onLayout={onTrackLayout}
        {...pan.panHandlers}
      >
        <View style={styles.intensityTrackBg} />
        <View
          style={[
            styles.intensityFill,
            { width: `${pct * 100}%` },
          ]}
        />
        {Array.from({ length: 10 }, (_, i) => (
          <View
            key={i}
            style={[
              styles.intensityTick,
              { left: (i / 9) * (trackW || 0) },
            ]}
          />
        ))}
        <View
          style={[
            styles.intensityThumb,
            big && styles.intensityThumbBig,
            { left: pct * (trackW || 0) },
          ]}
          pointerEvents="none"
        >
          <View
            style={[
              styles.intensityThumbDot,
              big && styles.intensityThumbDotBig,
            ]}
          />
        </View>
      </View>

      <View style={[styles.scaleRail, { marginTop: big ? 14 : 8 }]}>
        <Text style={styles.scaleRailText}>BARELY THERE</Text>
        <Text style={styles.scaleRailText}>UNBEARABLE</Text>
      </View>
    </View>
  );
}

// ─── styles ────────────────────────────────────────────────────

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  screenBody: { flex: 1, paddingHorizontal: 22, paddingBottom: 14, gap: 16 },

  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingTop: 6,
    height: 44,
  },
  topbarSpacer: { width: 60 },
  topbarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "flex-end",
    minWidth: 60,
  },
  themeToggle: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  backLink: { flexDirection: "row", alignItems: "center", gap: 4, width: 60 },
  backChevron: { color: theme.fgSoft, fontSize: 22, lineHeight: 22 },
  backText: { color: theme.fgSoft, fontSize: 13 },
  crumb: { ...type.crumb, color: theme.fgSoft },

  eyebrow: { ...type.eyebrow, color: theme.fgFaint },
  display: { ...type.display, color: theme.fg },
  displayBig: { ...type.displayBig, color: theme.fg },
  lede: { ...type.lede, color: theme.fgSoft },
  hint: { ...type.hint, color: theme.fgFaint },

  btn: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  btnPrimary: {
    backgroundColor: theme.accent,
    borderColor: "transparent",
    ...shadowSoft,
    shadowColor: theme.accent,
    shadowOpacity: 0.5,
  },
  btnPrimaryText: { color: theme.accentFg, fontSize: 15, fontWeight: "600" },
  btnPressed: { transform: [{ scale: 0.985 }] },
  btnDisabled: { opacity: 0.4 },
  btnGhost: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: { color: theme.fgSoft, fontSize: 15, fontWeight: "500" },

  chip: {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceMute,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    borderCurve: "continuous",
    alignItems: "center",
  },
  chipList: { paddingHorizontal: 14, alignItems: "flex-start" },
  chipSmall: { paddingVertical: 12, paddingHorizontal: 4 },
  chipOn: { backgroundColor: theme.accent, borderColor: "transparent" },
  chipListOn: {
    backgroundColor: theme.accentSoft,
    borderColor: theme.accent,
  },
  chipText: {
    color: theme.fg,
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },
  chipTextList: { fontSize: 15, textAlign: "left" },
  chipTextSmall: { fontSize: 13 },

  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    padding: 20,
  },
  cardFlush: { padding: 18 },
  cardSoft: { backgroundColor: theme.accentSoft, borderColor: "transparent" },
  cardMute: { backgroundColor: theme.surfaceMute, borderColor: theme.borderSoft },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
  pillText: { color: theme.fgSoft, fontSize: 12, fontWeight: "500" },

  intensity: { gap: 16 },
  intensityReadout: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 60,
  },
  intensityNum: {
    fontSize: 64,
    fontWeight: "300",
    color: theme.fg,
    letterSpacing: -2,
  },
  intensityNumBig: {
    fontSize: 92,
    fontWeight: "200",
    color: theme.fg,
    letterSpacing: -3,
  },
  intensityUnit: { fontSize: 18, fontWeight: "400", color: theme.fgFaint },

  intensityTrack: {
    height: 56,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  intensityTrackBig: { height: 64 },
  intensityTrackBg: {
    position: "absolute",
    left: 4,
    right: 4,
    height: 12,
    borderRadius: 999,
    backgroundColor: theme.surfaceMute,
    borderWidth: 1,
    borderColor: theme.borderSoft,
  },
  // CSS used a accent→wave-peak gradient; solid accent is a faithful
  // enough approximation without pulling in expo-linear-gradient.
  intensityFill: {
    position: "absolute",
    left: 4,
    height: 12,
    borderRadius: 999,
    backgroundColor: theme.accent,
  },
  intensityTick: {
    position: "absolute",
    width: 2,
    height: 4,
    borderRadius: 1,
    backgroundColor: theme.fgGhost,
    transform: [{ translateX: -1 }],
  },
  intensityThumb: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.border,
    transform: [{ translateX: -18 }],
    ...shadowSoft,
    shadowColor: theme.accent,
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  intensityThumbBig: {
    width: 44,
    height: 44,
    borderRadius: 22,
    transform: [{ translateX: -22 }],
  },
  intensityThumbDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.accent,
  },
  intensityThumbDotBig: { width: 18, height: 18, borderRadius: 9 },

  scaleRail: { flexDirection: "row", justifyContent: "space-between" },
  scaleRailText: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: theme.fgFaint,
  },
});
