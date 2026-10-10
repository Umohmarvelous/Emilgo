// components/ios/IOSTabBar.tsx
//
// The iOS 26 "Liquid Glass" tab bar, as shipped by WhatsApp and the system apps.
//
// What makes it read as current-iOS rather than a rounded rectangle:
//
//  1. It is a CAPSULE that FLOATS. It is inset from all three edges and sits
//     over the content rather than being welded to the bottom of the screen.
//  2. The material is genuinely translucent — content is visible and blurred
//     through it. Liquid Glass belongs to the navigation layer only; it is never
//     applied to content (lists, media), per Apple's HIG.
//  3. A specular rim. Real glass catches light at its edge: a hairline highlight
//     along the top, a darker one along the bottom. Without this the bar reads
//     as flat translucent plastic.
//  4. The selection indicator is a capsule that SLIDES between tabs with a
//     spring. It does not cut or fade — the movement is the affordance.
//  5. The selected glyph is TINTED as well as highlighted. iOS 26 uses colour
//     *and* shape for the active tab, not one or the other.
//  6. It minimises on scroll-down (`.tabBarMinimizeBehavior(.onScrollDown)`),
//     shrinking to give content the screen back, and returns on scroll-up.
//
// Icons are supplied by the caller (Emilgo passes its Hugeicons set) or drawn
// with a `render` callback, which is how the profile tab shows the user's
// avatar. Purely presentational: tabs + active + onChange, because Emilgo's
// (main)/_layout.tsx is a hand-rolled shell, not an expo-router <Tabs>.
//
// Screens must pad scroll content by useTabBarInset() so the last row clears it.

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HugeiconsIcon } from "@hugeicons/react-native";
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { haptics } from "@/src/utils/haptics";
import { useIOSTheme, IOSFont } from "./theme";
import { Glass, useGlassCapability } from "./Glass";

/** Height of the capsule at rest. */
export const TAB_BAR_HEIGHT = 65;
/** Height when minimised by scroll. */
export const TAB_BAR_MIN_HEIGHT = 50;
/** Gap between the capsule and the safe-area bottom. */
export const TAB_BAR_BOTTOM_GAP = -19;
/** Inset from the left/right screen edges. */
const H_MARGIN = 10;
/** Inner padding either side of the tab row. */
const ROW_PADDING = 5;

/** The spring iOS uses for the selection capsule — quick, barely any overshoot. */
const SELECT_SPRING = { damping: 20, stiffness: 260, mass: 0.9 };

export interface IOSTab {
  key: string;
  label: string;
  /** Hugeicons glyph for the inactive state. */
  icon?: unknown;
  /** Hugeicons glyph when selected. Falls back to `icon`. */
  iconActive?: unknown;
  /**
   * Draw something other than an icon — used for the profile tab's avatar.
   * Takes precedence over `icon`.
   */
  render?: (opts: { active: boolean; color: string; size: number }) => React.ReactNode;
  /** Badge count. 0 or undefined hides it. */
  badge?: number;
}

export interface IOSTabBarProps {
  tabs: IOSTab[];
  active: string;
  onChange: (key: string) => void;
  /** Hide labels for an icon-only bar. */
  hideLabels?: boolean;
  /**
   * Collapse to a compact capsule, giving content the screen back. Drive this
   * from scroll direction to match `.tabBarMinimizeBehavior(.onScrollDown)`.
   */
  minimized?: boolean;
}

/** Bottom padding a screen needs so content clears the floating capsule. */
export function useTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insets.bottom;
}

// ─── One tab ─────────────────────────────────────────────────────────────────

function TabItem({
  tab,
  active,
  hideLabel,
  minimized,
  onPress,
}: {
  tab: IOSTab;
  active: boolean;
  hideLabel?: boolean;
  minimized?: boolean;
  onPress: () => void;
}) {
  const theme = useIOSTheme();
  const [pressed, setPressed] = useState(false);

  // iOS 26 marks the active tab with colour AND the capsule behind it.
  const color = active ? theme.tint : theme.secondaryLabel;

  // Driven from state rather than by mutating a shared value in the press
  // handlers, so the React Compiler has nothing to flag.
  const animStyle = useAnimatedStyle(
    () => ({
      transform: [{ scale: withSpring(pressed ? 0.9 : 1, { damping: 16, stiffness: 380 }) }],
    }),
    [pressed],
  );

  // Labels fade out as the bar minimises, leaving the glyphs.
  const labelStyle = useAnimatedStyle(
    () => ({
      opacity: withTiming(minimized ? 0 : 1, { duration: 160 }),
      height: withTiming(minimized ? 0 : 14, { duration: 180 }),
    }),
    [minimized],
  );

  const glyph = active ? (tab.iconActive ?? tab.icon) : tab.icon;

  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      // The HIG minimum, kept even while minimised.
      hitSlop={6}
    >
      <Animated.View style={[styles.itemInner, animStyle]}>
        <View>
          {tab.render
            ? tab.render({ active, color, size: 25 })
            : glyph
              ? <HugeiconsIcon icon={glyph as never} size={25} color={color} />
              : <View style={{ width: 25, height: 25 }} />}

          {!!tab.badge && tab.badge > 0 && (
            <View style={[styles.badge, { backgroundColor: theme.tint }]}>
              <Text style={styles.badgeText} numberOfLines={1} maxFontSizeMultiplier={1.1}>
                {tab.badge > 99 ? "99+" : tab.badge}
              </Text>
            </View>
          )}
        </View>

        {!hideLabel && (
          <Animated.View style={labelStyle}>
            <Text
              numberOfLines={1}
              // Tab labels don't scale with Dynamic Type on iOS — they'd truncate.
              maxFontSizeMultiplier={1.2}
              style={[styles.label, { color, fontWeight: active ? "600" : "400" }]}
            >
              {tab.label}
            </Text>
          </Animated.View>
        )}
      </Animated.View>
    </Pressable>
  );
}

// ─── Bar ─────────────────────────────────────────────────────────────────────

export function IOSTabBar({
  tabs,
  active,
  onChange,
  hideLabels,
  minimized = false,
}: IOSTabBarProps) {
  const theme = useIOSTheme();
  const insets = useSafeAreaInsets();
  const isDark = theme.scheme === "dark";
  // On iOS 26 the bar is a real UIGlassEffect capsule. Everywhere else it keeps
  // the blur-and-veil build below, so the shape, spring and rim are unchanged.
  const { glass } = useGlassCapability();

  // Measured so the selection capsule can be positioned exactly, whatever the
  // screen width or tab count.
  const [rowWidth, setRowWidth] = useState(0);
  const onRowLayout = useCallback((e: LayoutChangeEvent) => {
    setRowWidth(e.nativeEvent.layout.width);
  }, []);

  const activeIndex = Math.max(0, tabs.findIndex((t) => t.key === active));
  const tabWidth = tabs.length > 0 && rowWidth > 0 ? rowWidth / tabs.length : 0;

  const handlePress = useCallback(
    (key: string) => {
      if (key !== active) haptics.select();
      onChange(key);
    },
    [active, onChange],
  );

  // The signature iOS 26 move: the capsule slides to the selected tab.
  const highlightStyle = useAnimatedStyle(
    () => ({
      width: tabWidth,
      transform: [{ translateX: withSpring(activeIndex * tabWidth, SELECT_SPRING) }],
      opacity: tabWidth > 0 ? 1 : 0,
    }),
    [activeIndex, tabWidth],
  );

  // Collapse the whole capsule when minimised.
  const capsuleStyle = useAnimatedStyle(() => {
    const h = withSpring(minimized ? TAB_BAR_MIN_HEIGHT : TAB_BAR_HEIGHT, {
      damping: 22,
      stiffness: 220,
    });
    return { height: h, borderRadius: TAB_BAR_HEIGHT / 2 };
  }, [minimized]);

  return (
    <View
      style={[styles.container, { bottom: insets.bottom + TAB_BAR_BOTTOM_GAP }]}
      // Only the capsule takes touches; the rest of the row lets content through.
      pointerEvents="box-none"
    >
      <Animated.View
        style={[
          styles.capsule,
          capsuleStyle,
          { shadowColor: isDark ? "#000" : "#0B1F16" },
        ]}
      >
        {/* The capsule's material. On iOS 26 this is real Liquid Glass — which
            is genuinely see-through and lights its own edge. On every other
            path it's the blur-plus-veil build the bar has always used: a light
            veil to keep glyphs legible, not an opaque fill. Android's blur is
            much weaker, so it gets more backing. */}
        <Glass
          variant="regular"
          radius={TAB_BAR_HEIGHT / 2}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={20}
          // fallbackTint={isDark ? "rgba(30,30,32,0.55)" : "rgba(255,255,255,0.55)"}
          // androidTint={isDark ? "rgba(28,28,30,0.86)" : "rgba(201 201 201 / 0.9)"}
          fallbackTint={isDark ? "rgba(30,30,32,0.55)" : "rgba(238 238 238 / 0.55)"}
          androidTint={isDark ? "rgba(28,28,30,0.86)" : "rgba(201 201 201 / 0.9)"}
        />

        {/* Specular rim — glass catches light along its top edge and shades along
            the bottom. This is what stops the fallback reading as flat plastic.
            Real Liquid Glass draws its own edge, so adding ours would double it. */}
        {!glass && (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.rim,
              {
                borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.75)",
                borderTopColor: isDark ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.95)",
                borderBottomColor: isDark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.06)",
              },
            ]}
          />
        )}

        <View style={styles.row} onLayout={onRowLayout}>
          {/* Selection capsule, sliding under the tabs. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.highlight,
              highlightStyle,
              { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)" },
            ]}
          />

          {tabs.map((tab) => (
            <TabItem
              key={tab.key}
              tab={tab}
              active={tab.key === active}
              hideLabel={hideLabels}
              minimized={minimized}
              onPress={() => handlePress(tab.key)}
            />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  capsule: {
    marginHorizontal: H_MARGIN,
    overflow: "hidden",
    // Floats the glass off the content behind it.
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 12,  
  },
  rim: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: TAB_BAR_HEIGHT / 2,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: ROW_PADDING, 
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    // Apple's minimum tappable target.
    minHeight: 44,
  },
  highlight: {
    position: "absolute",
    top: 5,
    bottom: 5,
    left: 0,
    width: "10%",

    // A capsule, matching the bar's own geometry.
    borderRadius: 999, 
  },
  itemInner: { alignItems: "center", justifyContent: "center", gap: 2 },
  label: { ...IOSFont.caption2, fontSize: 11, lineHeight: 13 },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});

export default IOSTabBar;
