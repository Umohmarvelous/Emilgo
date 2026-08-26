// components/ios/SwipeableTabs.tsx
//
// Profile-style tabs: a hero header that scrolls away, a bar that stays pinned
// at the very top, a tab strip that travels with the content until it meets
// that bar and then sticks under it, and panes you can swipe between.
//
//   ┌───────────────────────────┐  ← bar: pinned, always at the top
//   │  ‹avatar›   status   ⌕ ⋯  │
//   ├───────────────────────────┤
//   │      hero (scrolls away)  │
//   │   ╭─────────────────────╮ │  ← strip: scrolls up, then pins under the bar
//   │   │ Profile │ … │ …     │ │
//   │   ╰─────────────────────╯ │
//   │        active pane        │
//   └───────────────────────────┘
//
// ── Why this isn't a PagerView ───────────────────────────────────────────────
// The obvious build is a vertical ScrollView containing a horizontal pager, but
// a pager has no intrinsic height — it must be told one — and these panes differ
// wildly (a settings list is several screens tall, a stats pane is barely one).
// Fixing a height either clips the tall pane or leaves dead space under the
// short one.
//
// So only the ACTIVE pane is mounted, inside the normal vertical scroll, and it
// sizes itself. Horizontal swiping comes from a pan gesture that fails fast on
// vertical movement, which hands the scroll straight back to the ScrollView. The
// result behaves like a pager without inheriting its layout problem.
//
// ── Why pinning isn't `stickyHeaderIndices` ──────────────────────────────────
// Sticky headers pin at the top of the scroll VIEWPORT, which here is behind the
// pinned bar — the strip would slide under it and disappear. There is no
// cross-platform way to tell a sticky header to stop lower down (iOS honours
// `contentInset`, Android does not).
//
// So the strip is an overlay driven by the scroll position:
//
//     translateY = max(barHeight, stripRestY − scrollY)
//
// It runs on the UI thread through Reanimated, so it tracks the finger exactly,
// and it pins wherever we say rather than wherever the platform decides.
//
// ── The two animation rules ──────────────────────────────────────────────────
// Panes move on `translateX` only and the strip on `translateY` only. Neither
// ever animates opacity, because both carry glass and animating alpha above a
// GlassView renders the effect incorrectly (expo/expo#41024). The bar's glass
// materialises through `present` for the same reason.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  type LayoutChangeEvent,
  type ViewStyle,
  type StyleProp,
  type RefreshControlProps,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";

import { haptics } from "@/src/utils/haptics";
import { useIOSTheme } from "./theme";
import { IOSSegmentedTabs, type IOSSegment, type IOSSegmentedVariant } from "./IOSSegmentedTabs";

/** Horizontal travel before a swipe counts as a tab change. */
const SWIPE_DISTANCE = 60;
/** Fling speed that changes tab regardless of distance. */
const SWIPE_VELOCITY = 500;
/** How far a pane starts from its resting place when it comes in. */
const PANE_TRAVEL = 30;
const PANE_SPRING = { damping: 22, stiffness: 230, mass: 0.85 } as const;
/** Scroll offset at which the pinned bar counts as collapsed. */
const COLLAPSE_AT = 28;
/** Fallback strip height, used only for the first frame before it's measured. */
const STRIP_FALLBACK = 68;

export interface SwipeableTabsProps<T extends string = string> {
  segments: IOSSegment<T>[];
  active: T;
  onChange: (key: T) => void;
  /** Rendered above the tab strip; scrolls away. */
  header?: React.ReactNode;
  /** Pane for the active tab. */
  children: React.ReactNode;
  /**
   * Chrome pinned at the very top. Receives whether the header has scrolled
   * far enough to count as collapsed, so it can swap a title in.
   */
  renderBar?: (collapsed: boolean) => React.ReactNode;
  /** Height of that bar, INCLUDING the status bar. Content starts below it. */
  barHeight?: number;
  /** Passed to the underlying scroll view — insets, handlers, keyboard config. */
  scrollProps?: object;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Corner radius on the strip's outer corners. */
  radius?: number;
  /** Which segmented look the strip uses. */
  variant?: IOSSegmentedVariant;
  /** Side gutter for the pinned strip. */
  stripInset?: number;
  /** Height of the segmented control itself. */
  stripHeight?: number;
  /**
   * Scroll offset, if the caller needs it too.
   *
   * Chrome that has to travel *continuously* with the scroll — an avatar
   * shrinking into the bar, say — can't work from the `collapsed` boolean,
   * which only says which side of a threshold we're on. Pass a shared value and
   * it's driven from the same handler, so the two never disagree by a frame.
   */
  scrollY?: SharedValue<number>;
}

export function SwipeableTabs<T extends string = string>({
  segments,
  active,
  onChange,
  header,
  children,
  renderBar,
  barHeight = 0,
  scrollProps,
  refreshControl,
  contentContainerStyle,
  radius,
  variant = "capsule",
  stripInset = 16,
  stripHeight = 52,
  scrollY: externalScrollY,
}: SwipeableTabsProps<T>) {
  const theme = useIOSTheme();

  // The pinned strip is drawn OVER the scrollable, so a RefreshControl at y=0
  // spins underneath it. `barHeight` is exactly how far down it has to start to
  // clear the bar. A caller that sets its own offset still wins.
  const refreshControlWithOffset = React.useMemo(
    () =>
      refreshControl
        ? React.cloneElement(refreshControl, {
            progressViewOffset: refreshControl.props.progressViewOffset ?? barHeight,
          })
        : undefined,
    [refreshControl, barHeight],
  );

  const internalScrollY = useSharedValue(0);
  const scrollY = externalScrollY ?? internalScrollY;

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const [headerHeight, setHeaderHeight] = useState(0);
  const [stripBox, setStripBox] = useState(STRIP_FALLBACK);
  const [collapsed, setCollapsed] = useState(false);

  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setHeaderHeight(e.nativeEvent.layout.height);
  }, []);

  const onStripLayout = useCallback((e: LayoutChangeEvent) => {
    setStripBox(e.nativeEvent.layout.height);
  }, []);

  // The bar's glass materialises on a threshold rather than fading, so the
  // collapsed flag is JS state driven from the UI thread.
  useAnimatedReaction(
    () => scrollY.value > COLLAPSE_AT,
    (next, previous) => {
      if (next !== previous) runOnJS(setCollapsed)(next);
    },
  );

  // Where the strip sits when nothing has scrolled, in the container's own
  // coordinates: below the pinned bar and below the header.
  const stripRestY = barHeight + headerHeight;

  const stripStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(barHeight, stripRestY - scrollY.value) }],
  }));

  const activeIndex = useMemo(() => {
    const i = segments.findIndex((s) => s.key === active);
    return i === -1 ? 0 : i;
  }, [segments, active]);

  // Pane entrance. Direction comes from which way the index moved, so a pane
  // always arrives from the side you swiped away from.
  const paneShift = useSharedValue(0);
  const previousIndex = useRef(activeIndex);

  useEffect(() => {
    const from = previousIndex.current;
    if (from === activeIndex) return;
    previousIndex.current = activeIndex;
    paneShift.value = activeIndex > from ? PANE_TRAVEL : -PANE_TRAVEL;
    paneShift.value = withSpring(0, PANE_SPRING);
  }, [activeIndex, paneShift]);

  const paneStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: paneShift.value }],
  }));

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = activeIndex + direction;
      if (next < 0 || next >= segments.length) return;
      haptics.select();
      onChange(segments[next].key);
    },
    [activeIndex, onChange, segments],
  );

  // Claims the gesture only once it's clearly horizontal; anything vertical
  // fails immediately and the ScrollView takes over, so scrolling never fights
  // the swipe.
  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onEnd((e) => {
      const far = Math.abs(e.translationX) > SWIPE_DISTANCE;
      const fast = Math.abs(e.velocityX) > SWIPE_VELOCITY;
      if (!far && !fast) return;
      runOnJS(step)(e.translationX < 0 ? 1 : -1);
    });

  return (
    <View style={[styles.root, {}]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEventThrottle={16}
        refreshControl={refreshControlWithOffset}
        {...scrollProps}
        onScroll={onScroll}
        contentContainerStyle={[{ paddingTop: barHeight }, contentContainerStyle]}
        scrollIndicatorInsets={{ top: barHeight }}
      >
        <View onLayout={onHeaderLayout}>{header}</View>

        {/* The strip is an overlay, so the flow needs a hole the same size for
            it to sit in while nothing has scrolled. */}
        <View style={{ height: stripBox }} />

        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.pane, paneStyle]} collapsable={false}>
            {children}
          </Animated.View>
        </GestureDetector>
      </Animated.ScrollView>

      {/* Pinned strip. Above the scroll view so it can outlive its own scroll
          position; it carries no background of its own beyond the control,
          which lets the page show through on either side. */}
      <Animated.View
        onLayout={onStripLayout}
        pointerEvents="box-none"
        style={[styles.strip, { left: stripInset, right: stripInset }, stripStyle, ]}
      >
        <IOSSegmentedTabs
          segments={segments}
          active={active}
          onChange={onChange}
          variant={variant}
          radius={radius}
          height={stripHeight}
          rounded="all"
        />
      </Animated.View>

      {/* Bar last: it must stay above the strip as the strip slides under it. */}
      {renderBar ? (
        <View
          pointerEvents="box-none"
          style={[styles.bar, { height: barHeight, borderBottomColor: theme.separator }]}
        >
          {renderBar(collapsed)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pane: { flex: 1 },
  strip: {
    position: "absolute",
    top: 0,
    zIndex: 20,
    paddingVertical: 8,
  },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30
  },
});

export default SwipeableTabs;
