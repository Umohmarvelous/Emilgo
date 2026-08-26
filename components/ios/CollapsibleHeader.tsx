// components/ios/CollapsibleHeader.tsx
//
// The iOS large-title navigation bar and its collapse behaviour.
//
// At rest: the title sits LEFT in a large font, over a transparent bar.
// On scroll: the large title fades and slides up while a small CENTRED title
// fades in, and the bar background transitions to frosted glass with a hairline
// separator — the same choreography as Settings, Mail or Messages.
//
// Runs entirely on the UI thread via Reanimated's scroll handler, so it never
// stutters even while a list is being flung.
//
// Usage
// ─────
//   const scrollY = useCollapsibleScroll();
//
//   <CollapsibleHeader title="Route History" scrollY={scrollY.value} />
//   <Animated.FlatList onScroll={scrollY.onScroll} scrollEventThrottle={16}
//     contentContainerStyle={{ paddingTop: scrollY.contentInset }} … />
//
// Works with Animated.ScrollView and Animated.FlatList alike — anything that
// accepts an animated `onScroll`.

import React from "react";
import {
  View,
  Pressable,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useAnimatedReaction,
  runOnJS,
  interpolate,
  Extrapolation,
  type SharedValue,
} from "react-native-reanimated";

import { useIOSTheme, IOSFont, IOSMetrics, IOSAppFont } from "./theme";
import { TAB_BAR_HEIGHT, TAB_BAR_BOTTOM_GAP } from "./IOSTabBar";
import { Glass } from "./Glass";
import { NetworkStatus, useConnectionQuality } from "./NetworkStatus";

/** Height of the compact bar, excluding the status bar. */
export const NAV_BAR_HEIGHT = 44;
/**
 * Breathing room between the bottom of the header and the first row of content.
 *
 * Without it `contentInset` puts the first card flush against the nav bar, so a
 * screen at rest looks like the content is stuck to the title. iOS's own list
 * screens leave roughly this much; matching it is what makes a migrated screen
 * stop looking cramped.
 *
 * It is deliberately NOT folded into `contentInset`, because that number is
 * also the scroll-indicator inset and the pull-to-refresh offset, and both of
 * those must line up with the ACTUAL bar, not with the bar plus a gap.
 */
export const HEADER_CONTENT_GAP = 16;
/** Extra height the large title occupies below the compact bar. */
export const LARGE_TITLE_HEIGHT = 52;
/** Scroll distance over which the collapse completes. */
const COLLAPSE_DISTANCE = LARGE_TITLE_HEIGHT;


export interface CollapsibleScroll {
  /** Pass to `<CollapsibleHeader scrollY={…} />`. */
  value: SharedValue<number>;
  /** Spread onto the animated scrollable. */
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  /**
   * Height of the header itself. Use for scroll-indicator insets and for a
   * RefreshControl's `progressViewOffset` — anything that must align with the
   * bar rather than with the content.
   */
  contentInset: number;
  /**
   * Top padding for content: the header plus `HEADER_CONTENT_GAP`. This is what
   * a `contentContainerStyle` wants; `scrollProps` already applies it.
   */
  contentTop: number;
  /**
   * Pass to `<RefreshControl progressViewOffset={…} />`. Without it the spinner
   * is drawn at y=0, which on a translucent-header screen means underneath the
   * header where nobody can see it — the refresh looks broken even though it is
   * working.
   */
  refreshOffset: number;
  /** Bottom padding so the last row clears the floating tab bar. */
  bottomInset: number;
  /**
   * Spread straight onto the scrollable. Carries the handler, both content
   * insets and matching scroll-indicator insets in one go, so a screen can't
   * accidentally apply the top inset and forget the bottom.
   */
  scrollProps: {
    onScroll: ReturnType<typeof useAnimatedScrollHandler>;
    scrollEventThrottle: number;
    contentContainerStyle: { paddingTop: number; paddingBottom: number };
    scrollIndicatorInsets: { top: number; bottom: number };
  };
}

export interface UseCollapsibleScrollOptions {
  /**
   * Leave room for the floating tab bar. Screens inside the tab shell want
   * this; pushed screens and modals don't.
   */
  tabBar?: boolean;
  /** Extra bottom padding on top of whatever the tab bar needs. */
  extraBottom?: number;
}

/**
 * Scroll plumbing for a collapsible screen.
 *
 * Both insets are CONTENT insets, never frame padding. The scrollable fills
 * the screen so content passes under the header and the tab bar — that
 * overlap is the entire reason the chrome is translucent. Padding the frame
 * instead leaves the glass with nothing behind it to sample.
 */
export function useCollapsibleScroll(
  options: UseCollapsibleScrollOptions = {},
): CollapsibleScroll {
  const { tabBar = false, extraBottom = 0 } = options;
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const contentInset = insets.top + NAV_BAR_HEIGHT + LARGE_TITLE_HEIGHT;
  const contentTop = contentInset + HEADER_CONTENT_GAP;
  const bottomInset =
    (tabBar ? TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insets.bottom : insets.bottom) + extraBottom;

  return {
    value: scrollY,
    onScroll,
    contentInset,
    contentTop,
    refreshOffset: contentInset,
    bottomInset,
    scrollProps: {
      onScroll,
      scrollEventThrottle: 16,
      // Content gets the gap; the indicator does not — it should track the bar.
      contentContainerStyle: { paddingTop: contentTop, paddingBottom: bottomInset },
      scrollIndicatorInsets: { top: contentInset, bottom: bottomInset },
    },
  };
}

export interface CollapsibleHeaderProps {
  title: string;
  scrollY: SharedValue<number>;
  /**
   * When false the header renders in its resting large-title state and never
   * animates. Use it on screens with nothing scrollable — a collapsing header
   * that can't collapse reads as broken.
   */
  collapsible?: boolean;
  /** Left slot — typically a back button. */
  left?: React.ReactNode;
  /** Right slot — typically an action button. */
  right?: React.ReactNode;
  /** Subtitle shown under the large title; fades out with it. */
  subtitle?: string;
  /** Tap the compact bar to scroll back to top (iOS status-bar behaviour). */
  onTitlePress?: () => void;
  style?: ViewStyle;
}

export function CollapsibleHeader({
  title,
  scrollY,
  collapsible = true,
  left,
  right,
  subtitle,
  onTitlePress,
  style,
}: CollapsibleHeaderProps) {
  const theme = useIOSTheme();
  const insets = useSafeAreaInsets();

  const totalHeight = insets.top + NAV_BAR_HEIGHT + LARGE_TITLE_HEIGHT;

  // The hairline fades in as the title collapses. The GLASS cannot: opacity on
  // a GlassView's ancestor renders the effect incorrectly (expo/expo#41024), so
  // the bar materialises on a threshold instead of fading on a curve. Apple
  // presents glass this way too — by animating the effect, not the alpha.
  const hairlineStyle = useAnimatedStyle(() => ({
    opacity: collapsible
      ? interpolate(scrollY.value, [0, COLLAPSE_DISTANCE], [0, 1], Extrapolation.CLAMP)
      : 0,
  }));

  const [barMaterialised, setBarMaterialised] = React.useState(false);

  // Every screen reports connection trouble in the same place.
  const degraded = useConnectionQuality() !== "healthy";

  useAnimatedReaction(
    () => collapsible && scrollY.value > COLLAPSE_DISTANCE * 0.35,
    (should, previous) => {
      if (should !== previous) runOnJS(setBarMaterialised)(should);
    },
    [collapsible],
  );

  // Large title: fades out over the first 60% of the travel and drifts upward.
  const largeTitleStyle = useAnimatedStyle(() => {
    if (!collapsible) return { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] };
    return {
    opacity: interpolate(
      scrollY.value,
      [0, COLLAPSE_DISTANCE * 0.6],
      [1, 0],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [0, COLLAPSE_DISTANCE],
          [0, -12],
          Extrapolation.CLAMP,
        ),
      },
      {
        // Slight shrink as it goes, so it reads as the same title moving.
        scale: interpolate(scrollY.value, [0, COLLAPSE_DISTANCE], [1, 0.92], Extrapolation.CLAMP),
      },
    ],
    };
  });

  // Compact centred title: only appears once the large one is mostly gone.
  const compactTitleStyle = useAnimatedStyle(() => {
    if (!collapsible) return { opacity: 0, transform: [{ translateY: 8 }] };
    return {
    opacity: interpolate(
      scrollY.value,
      [COLLAPSE_DISTANCE * 0.55, COLLAPSE_DISTANCE],
      [0, 1],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [COLLAPSE_DISTANCE * 0.55, COLLAPSE_DISTANCE],
          [8, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
    };
  });

  // The whole header shrinks to just the compact bar as you scroll.
  const containerStyle = useAnimatedStyle(() => ({
    height: collapsible
      ? interpolate(
          scrollY.value,
          [0, COLLAPSE_DISTANCE],
          [totalHeight, insets.top + NAV_BAR_HEIGHT],
          Extrapolation.CLAMP,
        )
      : totalHeight,
  }));

  return (
    <Animated.View style={[styles.container, containerStyle, style ]} pointerEvents="box-none">
      {/* Frosted background, revealed on scroll */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Liquid Glass nav bar. It materialises via `present` rather than
            being faded by a parent — see the note on hairlineStyle. */}
        <Glass
          variant="regular"
          present={barMaterialised}
          animated
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={10}
          fallbackTint={
            theme.scheme === "dark" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.72)"
          }

          // Android's blur is much weaker, so its veil carries more of the load.
          androidTint={
            theme.scheme === "dark" ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.85)"
          }
        />
        <Animated.View
          style={[
            styles.hairline,
            { backgroundColor: theme.separator, top: undefined, bottom: 0 },
            hairlineStyle,
          ]}
        />
      </View>

      {/* Compact bar: back / centred title / action */}
      <View style={[styles.bar, { marginTop: insets.top }, {}]} pointerEvents="box-none">
        <View style={styles.barSide}>{left}</View>

        <Pressable
          style={styles.barCenter}
          onPress={onTitlePress}
          disabled={!onTitlePress}
          accessibilityRole="header"
        >
          {degraded ? (
            // While the connection is poor the centre slot reports that
            // instead of the title. It's the same slot, so the bar never
            // changes height, and the title returns the moment we recover.
            <NetworkStatus />
          ) : (
          <Animated.Text
            numberOfLines={1}
            style={[
              IOSFont.headline,
              { fontFamily: IOSAppFont.label.fontFamily, color: theme.label },
              compactTitleStyle,
            ]}
          >
            {title}
          </Animated.Text>
          )}
        </Pressable>

        <View style={[styles.barSide, { alignItems: "flex-end" }]}>{right}</View>
      </View>

      {/* Large title, left-aligned */}
      <Animated.View style={[styles.largeWrap, largeTitleStyle]} pointerEvents="none">
        <Animated.Text
          numberOfLines={1}
          // Large titles are the one place iOS caps Dynamic Type growth, to
          // stop a long title truncating at accessibility sizes.
          maxFontSizeMultiplier={1.4}
          style={[
            IOSFont.largeTitle,
            { fontFamily: IOSAppFont.screenTitle.fontFamily, fontSize: 22, color: theme.label },
          ]}
        >
          {title}
        </Animated.Text>
        {subtitle ? (
          <Animated.Text
            numberOfLines={1}
            style={[
              IOSAppFont.description,
              { color: theme.secondaryLabel, marginTop: 1 },
            ]}
          >
            {subtitle}
          </Animated.Text>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: "hidden",
  },
  hairline: { position: "absolute", left: 0, right: 0, height: IOSMetrics.hairline },
  bar: {
    height: NAV_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  barSide: { minWidth: 60, justifyContent: "center" },
  barCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  largeWrap: {
    paddingHorizontal: IOSMetrics.groupedInset,
    justifyContent: "center",
    height: LARGE_TITLE_HEIGHT,
  },
});

export default CollapsibleHeader;
