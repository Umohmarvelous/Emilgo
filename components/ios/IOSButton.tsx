// components/ios/IOSButton.tsx
//
// The UIButton.Configuration styles from iOS, plus the standard tap feedback
// (brief opacity dip + light haptic) that system buttons use.
//
//   filled         — highest emphasis: accent-tinted glass, white label.
//   tinted         — secondary emphasis: plain glass, accent label.
//   bordered       — hairline accent border over glass, accent label.
//   borderless     — label only, no surface. Toolbar and nav actions.
//   glass          — iOS 26 `.glass()`, named explicitly.
//   prominentGlass — iOS 26 `.prominentGlass()`, named explicitly.
//
// Every variant that HAS a surface now draws it with Liquid Glass. There are no
// solid-colour buttons left in the kit: on iOS 26 they are real glass, and
// everywhere else they fall back to the exact fill they used to have, so
// Android and older iOS look unchanged.
//
// `borderless` is the one variant with no surface, because it has no shape to
// give glass — it is a bare label by definition.
//
// `role="destructive"` swaps the accent to systemRed everywhere, matching how
// iOS marks destructive actions.

import React, { useCallback } from "react";
import {
  Pressable,
  Text,
  View,
  ActivityIndicator,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
  type PressableProps,
} from "react-native";
import * as Haptics from "expo-haptics";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

import { useIOSTheme, IOSFont, IOSMetrics, IOSAppFont } from "./theme";
import { Glass, useGlassCapability } from "./Glass";

/**
 * The four classic styles, plus the two iOS 26 glass configurations:
 *   glass          → UIKit's `.glass()`         — plain Liquid Glass
 *   prominentGlass → UIKit's `.prominentGlass()` — glass tinted with the app accent
 */
export type IOSButtonVariant =
  | "filled"
  | "tinted"
  | "bordered"
  | "borderless"
  | "glass"
  | "prominentGlass";
export type IOSButtonRole = "normal" | "destructive";
export type IOSButtonSize = "small" | "medium" | "large";

// `role` is omitted from the inherited props because RN reuses that name for the
// ARIA role; here it means the iOS button role (normal / destructive).
export interface IOSButtonProps extends Omit<PressableProps, "style" | "children" | "role"> {
  title: string;
  variant?: IOSButtonVariant;
  role?: IOSButtonRole;
  size?: IOSButtonSize;
  /** SF Symbol name shown before the label, e.g. "paperplane.fill". */
  symbol?: SymbolViewProps["name"];
  loading?: boolean;
  /** Stretch to the container width — standard for a sheet's primary action. */
  fullWidth?: boolean;
  /** Suppress the light haptic on press. */
  noHaptics?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const SIZES: Record<IOSButtonSize, { height: number; padH: number; font: TextStyle; radius: number; icon: number }> = {
  small:  { height: 34, padH: 14, font: IOSFont.subheadline, radius: 8,  icon: 15 },
  medium: { height: 44, padH: 18, font: IOSFont.body,        radius: 50, icon: 17 },
  large:  { height: 50, padH: 22, font: IOSFont.headline,    radius: 20, icon: 19 },
};

export function IOSButton({
  title,
  variant = "filled",
  role = "normal",
  size = "medium",
  symbol,
  loading = false,
  fullWidth = false,
  noHaptics = false,
  disabled,
  onPress,
  style,
  textStyle,
  ...rest
}: IOSButtonProps) {
  const theme = useIOSTheme();
  const metrics = SIZES[size];
  // Real Liquid Glass supplies its own press feedback (scale + bounce); the
  // fallback surface doesn't, so it has to dim like every other button.
  const { glass: liveGlass } = useGlassCapability();

  const accent = role === "destructive" ? theme.systemRed : theme.systemGray;
  const isDisabled = disabled || loading;

  // Everything but a bare label sits on glass now.
  const isGlass = variant !== "borderless";
  // The two high-emphasis variants tint the surface with the accent, so their
  // label goes white; the rest tint the label instead.
  const prominent = variant === "filled" || variant === "prominentGlass";

  // const labelColor = prominent ? "#009A43" : accent;
  const labelColor = prominent ? theme.label : accent;

  const container: ViewStyle = {
    height: metrics.height,
    paddingHorizontal: variant === "borderless" ? 6 : metrics.padH,
    borderRadius: metrics.radius,
    minWidth: IOSMetrics.minTouchTarget,
    alignSelf: fullWidth ? "stretch" : "flex-start",
    // Glass supplies the surface — a background colour here would sit on top of
    // it and defeat the effect. Only the border is drawn on the container.
    backgroundColor: "transparent",
    ...(variant === "bordered" && { borderWidth: 1, borderColor: accent + "80" }),
  };

  const handlePress = useCallback<NonNullable<PressableProps["onPress"]>>(
    (e) => {
      if (!noHaptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress?.(e);
    },
    [noHaptics, onPress],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      accessibilityLabel={title}
      disabled={isDisabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        container,
        // iOS dims rather than scales on tap for standard buttons. Real glass
        // handles its own press feedback natively, so don't dim it as well —
        // but the fallback surface has none, so there it still dims.
        pressed && !(isGlass && liveGlass) && { opacity: 0.4 },
        isDisabled && { opacity: 0.35 },
        style,
        {
          // backgroundColor: theme.systemGreen,
          borderWidth: .5, borderColor: theme.separator,
          // alignSelf: 'center'
        }]}
      {...rest}
    >
      {isGlass && (
        <Glass
          variant="regular"
          tint={prominent ? accent : undefined}
          interactive
          radius={metrics.radius}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={20}
          // Off the glass path each variant falls back to the exact fill it had
          // before, so nothing about these buttons changes on Android or iOS 25.
          fallbackTint={
            prominent
              ? accent + "1F"
              : variant === "bordered"
                ? "transparent"
                : accent + "1F"
          }
        />
      )}
      
      {loading ? (
        <ActivityIndicator size="small" color={labelColor} />
      ) : (
        <View style={styles.row}>
          {symbol && (
            <SymbolView
              name={symbol}
              size={metrics.icon}
              tintColor={labelColor}
              resizeMode="scaleAspectFit"
              // Android/web have no SF Symbols; the label alone still reads fine.
              fallback={null}
            />
          )}
          <Text
            numberOfLines={1}
            style={[
              metrics.font,
              // Buttons are app UI, not system chrome, so they take Poppins.
              { fontFamily: IOSAppFont.button.fontFamily, color: labelColor },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
});

export default IOSButton;
