// components/ios/theme.ts
//
// iOS semantic design tokens for the native-feel component kit.
//
// Mirrors UIKit's semantic colour system (label / systemBackground / separator /
// fill levels) rather than hard-coding hexes at call sites, so every component
// adapts to light and dark automatically and stays consistent with system apps.
//
// Font: iOS system apps use San Francisco. Passing `undefined` as fontFamily
// makes React Native fall back to the system face, which IS SF on iOS and Roboto
// on Android — that's what "looks like a system app" requires. The rest of Emilgo
// uses Poppins; these components deliberately don't, so they read as native
// chrome. Override per-component with the `fontFamily` prop where you want the
// brand face instead.

import { useMemo } from "react";
import { Platform } from "react-native";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { Colors } from "@/constants/colors";

export type IOSColorScheme = "light" | "dark";

export interface IOSPalette {
  scheme: IOSColorScheme;
  /** Primary text. */
  label: string;
  secondaryLabel: string;
  tertiaryLabel: string;
  quaternaryLabel: string;

  /** Base surfaces. */
  systemBackground: string;
  secondarySystemBackground: string;
  tertiarySystemBackground: string;

  /** Grouped-table surfaces (Settings-style inset lists). */
  systemGroupedBackground: string;
  secondarySystemGroupedBackground: string;

  /** Hairlines and fills. */
  separator: string;
  opaqueSeparator: string;
  systemFill: string;
  secondarySystemFill: string;
  tertiarySystemFill: string;

  /** Standard system accents. */
  systemBlue: string;
  systemRed: string;
  systemGreen: string;
  systemOrange: string;
  systemGray: string;
  systemGray2: string;
  systemGray3: string;

  /** App accent — Emilgo green, used where a system app would use systemBlue. */
  tint: string;
  /** Scrim behind sheets and alerts. */
  scrim: string;
  /** Blur tint to pass to expo-blur. */
  blurTint: "light" | "dark" | "systemChromeMaterialLight" | "systemChromeMaterialDark";
}

const LIGHT: IOSPalette = {
  scheme: "light",

  label: "#000000",
  secondaryLabel: "rgba(60,60,67,0.60)",
  tertiaryLabel: "rgba(60,60,67,0.30)",
  quaternaryLabel: "rgba(60,60,67,0.18)",

  systemBackground: "#FFFFFF",
  secondarySystemBackground: "#F2F2F7",
  tertiarySystemBackground: "#FFFFFF",

  // Emilgo's own surfaces, not Apple's #F2F2F7 / #FFFFFF — so a migrated screen
  // sits on exactly the background the original design put it on.
  // systemGroupedBackground: Colors.border,
  systemGroupedBackground: '#ffffff',
  secondarySystemGroupedBackground: "#FFFFFF",

  separator: "rgba(60,60,67,0.29)",
  opaqueSeparator: "#C6C6C8",
  systemFill: "rgba(120,120,128,0.20)",
  secondarySystemFill: "rgba(120,120,128,0.16)",
  tertiarySystemFill: "rgba(118,118,128,0.12)",

  systemBlue: "#007AFF",
  systemRed: "#FF3B30",
  // systemGreen: "#34C759",
  systemGreen: "#009A43",
  systemOrange: "#FF9500",
  systemGray: "#8E8E93",
  systemGray2: "#AEAEB2",
  systemGray3: "#C7C7CC",

  tint: Colors.primary,
  scrim: "rgba(0,0,0,0.25)",
  blurTint: "systemChromeMaterialLight",
};

const DARK: IOSPalette = {
  scheme: "dark",

  label: "#FFFFFF",
  secondaryLabel: "rgba(235,235,245,0.60)",
  tertiaryLabel: "rgba(235,235,245,0.30)",
  quaternaryLabel: "rgba(235,235,245,0.18)",

  systemBackground: "#000000",
  secondarySystemBackground: "#1C1C1E",
  tertiarySystemBackground: "#2C2C2E",

  systemGroupedBackground: Colors.background,
  secondarySystemGroupedBackground: Colors.primaryDarker,

  separator: "rgba(84,84,88,0.60)",
  opaqueSeparator: "#38383A",
  systemFill: "rgba(120,120,128,0.36)",
  secondarySystemFill: "rgba(120,120,128,0.32)",
  tertiarySystemFill: "rgba(118,118,128,0.24)",

  systemBlue: "#0A84FF",
  systemRed: "#FF453A",
  // systemGreen: "#30D158",
  systemGreen: "#009A43",
  systemOrange: "#FF9F0A",
  systemGray: "#8E8E93",
  systemGray2: "#636366",
  systemGray3: "#48484A",

  tint: "#009A43",
  scrim: "rgba(0,0,0,0.45)",
  blurTint: "systemChromeMaterialDark",
};

/**
 * Current palette. Reads the app's own theme store (which ThemeSync already
 * keeps in step with the OS appearance) so the kit never disagrees with the
 * rest of Emilgo.
 */
export function useIOSTheme(): IOSPalette {
  const theme = useSettingsStore((s) => s.theme);
  return theme === "dark" ? DARK : LIGHT;
}

/** Non-hook read, for use outside React. */
export function getIOSTheme(): IOSPalette {
  return useSettingsStore.getState().theme === "dark" ? DARK : LIGHT;
}

// ─── Typography ──────────────────────────────────────────────────────────────
//
// The iOS text-style ramp at the default Dynamic Type size. Leave RN's
// `allowFontScaling` at its default (true) so these scale with the user's
// accessibility text-size setting — that's the Dynamic Type requirement.

export const IOSFont = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" as const, letterSpacing: 0.37 },
  title1:     { fontSize: 28, lineHeight: 34, fontWeight: "700" as const, letterSpacing: 0.36 },
  title2:     { fontSize: 22, lineHeight: 28, fontWeight: "700" as const, letterSpacing: 0.35 },
  title3:     { fontSize: 20, lineHeight: 25, fontWeight: "600" as const, letterSpacing: 0.38 },
  headline:   { fontSize: 17, lineHeight: 22, fontWeight: "600" as const, letterSpacing: -0.41 },
  body:       { fontSize: 17, lineHeight: 22, fontWeight: "400" as const, letterSpacing: -0.41 },
  callout:    { fontSize: 16, lineHeight: 21, fontWeight: "400" as const, letterSpacing: -0.32 },
  subheadline:{ fontSize: 15, lineHeight: 20, fontWeight: "400" as const, letterSpacing: -0.24 },
  footnote:   { fontSize: 13, lineHeight: 18, fontWeight: "400" as const, letterSpacing: -0.08 },
  caption1:   { fontSize: 12, lineHeight: 16, fontWeight: "400" as const, letterSpacing: 0 },
  caption2:   { fontSize: 11, lineHeight: 13, fontWeight: "400" as const, letterSpacing: 0.07 },
};

export type IOSFontStyle = keyof typeof IOSFont;

// ─── The app's own type ramp ─────────────────────────────────────────────────
//
// IOSFont above is the SYSTEM ramp (San Francisco), used for system chrome —
// alerts, menus, nav bars — where matching iOS exactly is the point.
//
// This is EMILGO's ramp: Poppins, at the sizes the app's original screens use.
// Components that are part of the app's own design rather than borrowed system
// chrome — settings rows, cards, section headings — take these instead, so a
// migrated screen keeps reading as Emilgo and not as a system app.

export const IOSAppFont = {
  /** Uppercase caption above a settings group. */
  sectionTitle: {
    fontFamily: "Poppins_500Medium",
    fontSize: 12,
    letterSpacing: 1,
  },
  /** Primary row text. */
  label: { fontFamily: "Poppins_500Medium", fontSize: 14 },
  /** Secondary row text under a label. */
  description: {
    fontFamily: "Poppins_400Regular",
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  /** Trailing value on a row, e.g. "English". */
  value: { fontFamily: "Poppins_400Regular", fontSize: 14 },
  /** Screen title in a header bar. */
  screenTitle: { fontFamily: "Poppins_700Bold", fontSize: 24 },
  /** Button labels. */
  button: { fontFamily: "Poppins_500Medium", fontSize: 15 },

  // ── The full ramp, mirroring IOSFont ──────────────────────────────────────
  //
  // The six entries above cover settings rows, which is all the kit needed at
  // first. Content-dense surfaces — the feed, a thread, a post — need the whole
  // ladder, and the named styles above don't say anything about relative size.
  //
  // These carry the same sizes and line heights as the matching IOSFont style,
  // in Poppins. Line height is copied rather than left to the font because
  // Poppins' natural leading is looser than San Francisco's, and a post body
  // set without it drifts noticeably taller than the system equivalent.
  title1: { fontFamily: "Poppins_700Bold", fontSize: 28, lineHeight: 34 },
  title2: { fontFamily: "Poppins_700Bold", fontSize: 22, lineHeight: 28 },
  title3: { fontFamily: "Poppins_600SemiBold", fontSize: 20, lineHeight: 25 },
  headline: { fontFamily: "Poppins_600SemiBold", fontSize: 17, lineHeight: 22 },
  body: { fontFamily: "Poppins_400Regular", fontSize: 16, lineHeight: 22 },
  callout: { fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 21 },
  subheadline: { fontFamily: "Poppins_500Medium", fontSize: 14, lineHeight: 19 },
  footnote: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 18 },
  caption1: { fontFamily: "Poppins_400Regular", fontSize: 12, lineHeight: 16 },
  caption2: { fontFamily: "Poppins_400Regular", fontSize: 11, lineHeight: 14 },
};

export type IOSAppFontStyle = keyof typeof IOSAppFont;

/** Standard iOS metrics. */
export const IOSMetrics = {
  /** Inset-grouped list side margin. */
  groupedInset: 16,
  /** Corner radius of an inset-grouped card. */
  groupedRadius: 10,
  /** Sheet / large modal corner radius. */
  sheetRadius: 30,
  /** Alert corner radius. */
  alertRadius: 30,
  /** Minimum tappable target per the HIG. */
  minTouchTarget: 44,
  /** Standard row height. */
  rowHeight: 44,
  hairline: Platform.select({ ios: 0.33, default: 0.5 }) as number,
};

/** Convenience: a text style object for a given ramp entry + colour. */
export function useIOSTextStyle(style: IOSFontStyle, color?: string) {
  const theme = useIOSTheme();
  return useMemo(
    () => ({ ...IOSFont[style], color: color ?? theme.label }),
    [style, color, theme.label],
  );
}
