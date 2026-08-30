// components/ios/IOSSheet.tsx
//
// An iOS-style sheet: rounded top corners, Liquid-Glass-style translucent
// material, blurred + dimmed backdrop, a grabber, and multi-detent drag —
// swipe UP to expand, DOWN to collapse, and past the smallest detent to dismiss.
//
// Mirrors UISheetPresentationController's model: the sheet view is always laid
// out at the height of its LARGEST detent, and smaller detents are expressed by
// translating it down. That's what makes expanding feel like the sheet growing
// rather than a new view appearing, and it keeps content from reflowing mid-drag.
//
// Deliberately self-contained (RN Modal + Reanimated + Gesture Handler) rather
// than built on @gorhom/bottom-sheet, so it drops into any screen without adding
// a provider to the app's composition root. It ships its own
// GestureHandlerRootView because gestures inside a native Modal need one.

import React, { useCallback, useEffect, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView, Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";

import { haptics } from "@/src/utils/haptics";
import { useIOSTheme, IOSFont, IOSMetrics } from "./theme";
import { Glass, GlassScrim } from "./Glass";

export type IOSSheetDetent = "medium" | "large" | number;

export interface IOSSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Heights the sheet can rest at. Give more than one to make it expandable by
   * dragging up, exactly like Maps or Music. Order doesn't matter.
   * Default: ["medium"].
   */
  detents?: IOSSheetDetent[];
  /** Single-detent shorthand. Ignored when `detents` is supplied. */
  detent?: IOSSheetDetent;
  /** Which detent to open at. Defaults to the smallest. */
  initialDetent?: IOSSheetDetent;
  title?: string;
  /** Trailing header action, e.g. a "Done" button. */
  headerRight?: React.ReactNode;
  /** Show the grabber pill. iOS shows it when the sheet is user-resizable. */
  showGrabber?: boolean;
  /** Allow tap-outside and swipe-down to close. */
  dismissible?: boolean;
  /** Fires when the resting detent changes, e.g. to load more content. */
  onDetentChange?: (detent: IOSSheetDetent) => void;
  contentStyle?: ViewStyle;
}

/** Fraction of the gap to the next detent that must be dragged to snap to it. */
const SNAP_DISTANCE_RATIO = 0.35;
/** Fling speed (px/s) that snaps a whole detent regardless of distance. */
const SNAP_VELOCITY = 700;
/** Downward fling speed that dismisses from the smallest detent. */
const CLOSE_VELOCITY = 900;
/** How far past the smallest detent to drag before dismissing. */
const CLOSE_DISTANCE = 90;

function resolveHeight(detent: IOSSheetDetent, screenH: number): number {
  if (typeof detent === "number") return screenH * Math.min(Math.max(detent, 0.15), 1);
  return detent === "large" ? screenH * 0.92 : screenH * 0.55;
}

export function IOSSheet({
  visible,
  onClose,
  children,
  detents,
  detent = "medium",
  initialDetent,
  title,
  headerRight,
  showGrabber = true,
  dismissible = true,
  onDetentChange,
  contentStyle,
}: IOSSheetProps) {
  const theme = useIOSTheme();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();

  // Resolve the detent list into pixel heights, ascending.
  const { heights, maxH, stops, initialStop } = useMemo(() => {
    const list = detents?.length ? detents : [detent];
    const hs = Array.from(new Set(list.map((d) => resolveHeight(d, screenH)))).sort(
      (a, b) => a - b,
    );
    const max = hs[hs.length - 1];
    // A detent's resting translateY is how far it sits below the full-height sheet.
    // Ascending heights → descending translateY, so reverse for a sorted stop list.
    const st = hs.map((h) => max - h).sort((a, b) => a - b);

    const wanted = initialDetent ? resolveHeight(initialDetent, screenH) : hs[0];
    const init = max - (hs.includes(wanted) ? wanted : hs[0]);

    return { heights: hs, maxH: max, stops: st, initialStop: init };
  }, [detents, detent, initialDetent, screenH]);

  const translateY = useSharedValue(maxH);
  // Where the current drag started, so movement is relative to the resting stop.
  const dragStart = useSharedValue(0);
  // The stop the sheet is currently resting at.
  const restingStop = useSharedValue(initialStop);

  // Animate in/out whenever visibility flips.
  useEffect(() => {
    if (visible) {
      restingStop.value = initialStop;
      translateY.value = withSpring(initialStop, { damping: 30, stiffness: 320, mass: 0.9 });
    } else {
      translateY.value = withTiming(maxH, { duration: 220 });
    }
  }, [visible, initialStop, maxH, translateY, restingStop]);

  const close = useCallback(() => {
    haptics.tap();
    onClose();
  }, [onClose]);

  const animateClosed = useCallback(() => {
    translateY.value = withTiming(maxH, { duration: 200 }, (finished) => {
      if (finished) runOnJS(close)();
    });
  }, [close, maxH, translateY]);

  const reportDetent = useCallback(
    (stop: number) => {
      if (!onDetentChange) return;
      const h = maxH - stop;
      const idx = heights.indexOf(h);
      const list = detents?.length ? detents : [detent];
      // Map the pixel height back to whichever detent produced it.
      const match = list.find((d) => resolveHeight(d, screenH) === h);
      if (match !== undefined) onDetentChange(match);
      else if (idx >= 0) onDetentChange(heights[idx] / screenH);
    },
    [detents, detent, heights, maxH, onDetentChange, screenH],
  );

  const settle = useCallback(
    (stop: number, changed: boolean) => {
      if (changed) haptics.tap();
      reportDetent(stop);
    },
    [reportDetent],
  );

  const pan = Gesture.Pan()
    .enabled(dismissible || stops.length > 1)
    // Only claim the gesture once it's clearly a vertical drag, so inner
    // ScrollViews and horizontal swipes still work.
    .activeOffsetY([-8, 8])
    .failOffsetX([-20, 20])
    .onStart(() => {
      dragStart.value = translateY.value;
    })
    .onUpdate((e) => {
      const next = dragStart.value + e.translationY;
      const smallest = stops[0];

      if (next < smallest) {
        // Above the tallest detent — rubber-band, the sheet can't grow further.
        translateY.value = smallest + (next - smallest) * 0.15;
      } else {
        translateY.value = next;
      }
    })
    .onEnd((e) => {
      const current = translateY.value;
      const largestStop = stops[stops.length - 1]; // smallest detent
      const v = e.velocityY;

      // Past the smallest detent and heading down → dismiss.
      if (
        dismissible &&
        (current > largestStop + CLOSE_DISTANCE || (v > CLOSE_VELOCITY && current >= largestStop))
      ) {
        translateY.value = withTiming(maxH, { duration: 200 }, (finished) => {
          if (finished) runOnJS(close)();
        });
        return;
      }

      // Otherwise snap to the nearest stop, biased by fling direction.
      const from = restingStop.value;
      const idx = stops.indexOf(from);
      let target = from;

      if (v < -SNAP_VELOCITY && idx > 0) {
        target = stops[idx - 1]; // flung up → expand
      } else if (v > SNAP_VELOCITY && idx < stops.length - 1) {
        target = stops[idx + 1]; // flung down → collapse
      } else {
        // Distance-based: take the nearest stop, requiring a meaningful drag.
        let best = stops[0];
        let bestDist = Math.abs(current - stops[0]);
        for (const s of stops) {
          const d = Math.abs(current - s);
          if (d < bestDist) {
            best = s;
            bestDist = d;
          }
        }
        const gap = Math.abs(best - from);
        target = gap > 0 && Math.abs(current - from) > gap * SNAP_DISTANCE_RATIO ? best : from;
      }

      const changed = target !== from;
      restingStop.value = target;
      translateY.value = withSpring(target, { damping: 30, stiffness: 320 });
      runOnJS(settle)(target, changed);
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // The scrim fades with the drag, exactly like a system sheet. It's driven off
  // the SMALLEST detent so the backdrop is already fully opaque by the time the
  // sheet is resting, and only fades as it's dragged away toward dismissal.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [stops[stops.length - 1], maxH],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismissible ? animateClosed : undefined}
    >
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        {/* Backdrop */}
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismissible ? animateClosed : undefined}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <GlassScrim intensity={18} />
          </Pressable>
        </Animated.View>

        {/* Sheet — always laid out at the tallest detent; smaller detents translate down. */}
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, { height: maxH, backgroundColor: "transparent" }, sheetStyle]}
            accessibilityViewIsModal
          >
            {/* Liquid Glass surface. Apple's guidance is that sheets adopt the
                glass appearance and drop custom backgrounds — so there's no tint
                layered on top of it here. */}
            <Glass
              variant="regular"
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              fallbackIntensity={80}
              fallbackTint={
                theme.scheme === "dark" ? "rgba(28,28,30,0.86)" : "rgba(252,252,254,0.86)"
              }
            />

            {showGrabber && (
              <View style={styles.grabberWrap}>
                <View style={[styles.grabber, { backgroundColor: theme.tertiaryLabel }]} />
              </View>
            )}

            {(title || headerRight) && (
              <View style={[styles.header, { borderBottomColor: theme.separator }]}>
                <View style={styles.headerSide} />
                <Text
                  numberOfLines={1}
                  style={[IOSFont.headline, { color: theme.label, flex: 1, textAlign: "center" }]}
                >
                  {title}
                </Text>
                <View style={[styles.headerSide, { alignItems: "flex-end" }]}>{headerRight}</View>
              </View>
            )}

            <View
              style={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) }, contentStyle]}
            >
              {children}
            </View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // borderTopLeftRadius: IOSMetrics.sheetRadius,
    borderRadius: IOSMetrics.sheetRadius,
    overflow: "hidden",
    margin: 4,
  },
  grabberWrap: { alignItems: "center", paddingTop: 5, paddingBottom: 2 },
  grabber: { width: 36, height: 5, borderRadius: 2.5, opacity: 0.5 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    height: 48,
    borderBottomWidth: IOSMetrics.hairline,
  },
  headerSide: { width: 64, justifyContent: "center" },
  content: { flex: 1, paddingHorizontal: IOSMetrics.groupedInset, paddingTop: 12 },
});

export default IOSSheet;
