
import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type LayoutChangeEvent,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { haptics } from "@/src/utils/haptics";
import { useIOSTheme, IOSAppFont } from "./theme";
import { Glass } from "./Glass";

export interface IOSSegment<T extends string = string> {
  key: T;
  label: string;
  /** Optional trailing count, rendered as a subdued number after the label. */
  badge?: number;
}

export type IOSSegmentedVariant = "underline" | "capsule";

export interface IOSSegmentedTabsProps<T extends string = string> {
  segments: IOSSegment<T>[];
  active: T;
  onChange: (key: T) => void;
  /** Corner radius of the control's outer corners. Capsules default to fully round. */
  radius?: number;
  /** Which corners round. 'top' suits a strip at the head of a card. */
  rounded?: "top" | "all";
  /** Underline the active segment, as an iOS tab bar does. Underline variant only. */
  underline?: boolean;
  /** Accent for the active label and underline. Defaults to the app tint. */
  tint?: string;
  height?: number;
  variant?: IOSSegmentedVariant;
  style?: StyleProp<ViewStyle>;
}

/** Inset of the thumb inside the track. */
const THUMB_INSET = 5;
/** Enough travel to feel physical, short enough to stay out of the way. */
const THUMB_SPRING = { damping: 20, stiffness: 240, mass: 0.8 } as const;

export function IOSSegmentedTabs<T extends string = string>({
  segments,
  active,
  onChange,
  radius,
  rounded = "top",
  underline = true,
  tint,
  height,
  variant = "underline",
  style,
}: IOSSegmentedTabsProps<T>) {
  const theme = useIOSTheme();
  const accent = tint ?? theme.tint;
  const last = segments.length - 1;

  const select = React.useCallback(
    (key: T, isActive: boolean) => {
      if (isActive) return;
      haptics.select();
      onChange(key);
    },
    [onChange],
  );

  // ── Capsule ────────────────────────────────────────────────────────────────
  if (variant === "capsule") {
    return (
      <CapsuleTabs
        segments={segments}
        active={active}
        onSelect={select}
        accent={accent}
        radius={radius}
        height={height}
        style={style}
      />
    );
  }

  // ── Underline ──────────────────────────────────────────────────────────────
  const r = radius ?? 30;

  const outer: ViewStyle =
    rounded === "all"
      ? { borderRadius: r }
      : { borderTopLeftRadius: r, borderTopRightRadius: r };

  return (
    <View style={[styles.row, outer, styles.clip, height ? { height } : null, style, {}]}>
      {segments.map((segment, i) => {
        const isActive = segment.key === active;

        // Only the outermost corners round — inner edges stay square so the
        // segments read as one surface rather than as separate buttons.
        const corners: ViewStyle = {
          borderTopLeftRadius: i === 0 ? r : 0,
          borderBottomLeftRadius: i === 0 && rounded === "all" ? r : 0,
          borderTopRightRadius: i === last ? r : 0,
          borderBottomRightRadius: i === last && rounded === "all" ? r : 0,
        };

        return (
          <Pressable
            key={segment.key}
            onPress={() => select(segment.key, isActive)}
            style={[styles.segment, corners, {}]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={segment.label}
          >
            {/* Active segments take the fuller material so the selection is
                legible; inactive ones stay clear and recede. */}
            {/* <Glass
              variant={isActive ? "regular" : "clear"}
              interactive
              style={[StyleSheet.absoluteFill, corners]}
              pointerEvents="none"
              fallbackIntensity={isActive ? 40 : 18}
              fallbackTint={isActive ? theme.systemFill : "transparent"}
            /> */}

            <Text
              numberOfLines={1}
              style={[
                IOSAppFont.label,
                styles.label,
                { color: isActive ? accent : theme.secondaryLabel },
                isActive && styles.labelActive,
              ]}
            >
              {segment.label}
            </Text>

            {underline && (
              <View
                style={[
                  styles.underline,
                  { backgroundColor: isActive ? accent : "transparent" },
                ]}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Capsule ─────────────────────────────────────────────────────────────────

interface CapsuleTabsProps<T extends string> {
  segments: IOSSegment<T>[];
  active: T;
  onSelect: (key: T, isActive: boolean) => void;
  accent: string;
  radius?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

function CapsuleTabs<T extends string>({
  segments,
  active,
  onSelect,
  accent,
  radius,
  height = 52,
  style,
}: CapsuleTabsProps<T>) {
  const theme = useIOSTheme();
  const [trackWidth, setTrackWidth] = React.useState(0);

  const activeIndex = Math.max(
    0,
    segments.findIndex((s) => s.key === active),
  );

  const trackRadius = radius ?? height / 2;
  const thumbRadius = Math.max(4, trackRadius - THUMB_INSET);
  const segmentWidth =
    trackWidth > 0 ? (trackWidth - THUMB_INSET * 2) / segments.length : 0;

  const x = useSharedValue(0);
  // The very first placement must not animate — a thumb that slides in from the
  // left on mount reads as the user having just switched tabs.
  const placed = React.useRef(false);

  React.useEffect(() => {
    if (segmentWidth <= 0) return;
    const target = activeIndex * segmentWidth;
    if (!placed.current) {
      placed.current = true;
      x.value = target;
      return;
    }
    x.value = withSpring(target, THUMB_SPRING);
  }, [activeIndex, segmentWidth, x]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  return (
    <View
      onLayout={onLayout}
      style={[styles.track, { height, borderRadius: trackRadius }, style, { borderWidth: .8, borderColor: theme.opaqueSeparator}]}
      accessibilityRole="tablist"
    >
      {/* The track is the quieter material: it's a container, not a control. */}
      <Glass
        variant="clear"
        radius={trackRadius}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        fallbackIntensity={26}
        fallbackTint={theme.tertiarySystemFill}
      />

      {/* Sliding thumb. Transform only — never opacity, which would corrupt the
          glass on iOS 26 (expo/expo#41024). */}
      {segmentWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              width: segmentWidth,
              top: THUMB_INSET,
              bottom: THUMB_INSET,
              left: THUMB_INSET,
              borderRadius: thumbRadius,
            },
            thumbStyle,
          ]}
        >
          <Glass
            variant="regular"
            interactive
            radius={thumbRadius}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            fallbackIntensity={70}
            fallbackTint={
              theme.scheme === "dark" ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.92)"
            }
          />
          {/* Glass clips, so the rim has to be drawn inside it rather than as a
              shadow outside. It's what separates thumb from track when the two
              materials sample the same background. */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: thumbRadius,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.separator,
              },
            ]}
          />
        </Animated.View>
      )}

      {segments.map((segment) => {
        const isActive = segment.key === active;
        return (
          <Pressable
            key={segment.key}
            onPress={() => onSelect(segment.key, isActive)}
            style={styles.capsuleSegment}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={segment.label}
          >
            <Text
              numberOfLines={1}
              style={[
                IOSAppFont.label,
                styles.label,
                {
                  color: isActive ? theme.label : theme.secondaryLabel,
                  fontFamily: isActive ? "Poppins_600SemiBold" : "Poppins_500Medium",
                },
              ]}
            >
              {segment.label}
            </Text>
            {segment.badge !== undefined && segment.badge > 0 && (
              <Text
                style={[
                  IOSAppFont.description,
                  styles.badge,
                  { color: isActive ? accent : theme.tertiaryLabel },
                ]}
              >
                {segment.badge > 99 ? "99+" : segment.badge}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  clip: { overflow: "hidden" },
  segment: {
    // Equal shares of whatever width the container gives us, so the strip is
    // responsive without measuring anything.
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  label: { textAlign: "center", paddingHorizontal: 6 },
  labelActive: { fontFamily: "Poppins_600SemiBold" },
  underline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
  },
  track: {
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
  },
  thumb: { position: "absolute", overflow: "hidden" },
  capsuleSegment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  badge: { marginTop: 0 },
});

export default IOSSegmentedTabs;
