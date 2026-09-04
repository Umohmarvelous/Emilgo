// components/ads/AdFloatingButton.tsx
//
// The floating "earn" button that lives on the home screen.
//
// ── What the popular apps actually do ───────────────────────────────────────
// The pattern is consistent across TikTok's coin chest, Opera's reward orb,
// Temu's spinner and every Nigerian fintech's promo bubble:
//
//   • It NEVER stops moving. A static floating button reads as chrome and gets
//     ignored within a day. A slow, continuous idle loop keeps it in peripheral
//     vision without demanding attention.
//   • The motion is a slow vertical float plus a periodic "attention beat" —
//     a quick double-pulse every several seconds. Continuous large motion is
//     irritating; a small drift punctuated by a rare beat is not.
//   • It carries state. A badge showing how many watches are left, and a ring
//     showing progress toward the next reward, so the button itself answers
//     "is there anything for me here?" without a tap.
//   • It goes quiet when there is nothing to earn. Bouncing at someone who has
//     hit the daily cap is how a reward button becomes an annoyance.
//
// ── The glass rule ─────────────────────────────────────────────────────────
// The button is glass, so NOTHING here animates opacity — not on the glass and
// not on any ancestor of it (expo/expo#41024). Every animation below is
// transform-only: translateY, scale, rotate. The one alpha change is the
// progress ring's colour, which is a plain View sitting on top of the glass.

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  withSpring,
  Easing,
  interpolate,
  cancelAnimation,
} from "react-native-reanimated";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { Fire02Icon } from "@hugeicons/core-free-icons";

import { Glass, useIOSTheme, IOSAppFont } from "@/components/ios";
import { useAdsStore } from "@/src/store/useAdsStore";

/** How far the idle float travels, in points. Deliberately small. */
const FLOAT_TRAVEL = 0
const FLOAT_MS = 3000;
/** Gap between attention beats. Long enough not to nag. */
const BEAT_INTERVAL_MS = 2000;



// ═════════════════════════════════════════════════════════════════════════════

/**
 * The flame flickers only while a streak is alive. A permanently animating
 * icon is noise; one that stops when the streak breaks carries information.
 */
function FlameIcon({ active, colour }: { active: boolean; colour: string }) {
  const v = useSharedValue(0);

  React.useEffect(() => {
    if (!active) {
      cancelAnimation(v);
      v.value = 0;
      return;
    }
    v.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 620, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(v);
  }, [active, v]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(v.value, [0, 1], [1, 1.14]) },
      { rotate: `${interpolate(v.value, [0, 1], [-4, 4])}deg` },
    ],
  }));

  return (
    <Animated.View style={[style]}>
      <HugeiconsIcon icon={Fire02Icon} size={36} fill={colour}  color={colour} strokeWidth={0} />
    </Animated.View>
  );
}




export interface AdFloatingButtonProps {
  /** Distance from the bottom, so callers can clear a tab bar. */
  bottom?: number;
  right?: number;
}

export function AdFloatingButton({ bottom = 96, right = 16 }: AdFloatingButtonProps) {
  const t = useIOSTheme();
  const d = useAdsStore((s) => s.dashboard);
  const refresh = useAdsStore((s) => s.refresh);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // Quiet mode: nothing left to earn today. The button stays — the user may
  // still want their history — but it stops asking for attention.
  const idle = d.remaining_today <= 0;

  const float = useSharedValue(0);
  const beat = useSharedValue(0);
  const press = useSharedValue(0);

  // ── Idle float ───────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (idle) {
      cancelAnimation(float);
      float.value = withTiming(0, { duration: 400 });
      return;
    }
    float.value = withRepeat(
      withSequence(
        withTiming(1, { duration: FLOAT_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: FLOAT_MS, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(float);
  }, [idle, float]);

  // ── Attention beat ───────────────────────────────────────────────────────
  // A double-pulse, then a long pause. Built as one repeating sequence rather
  // than a setInterval so it stays on the UI thread and cannot drift or leak.
  React.useEffect(() => {
    if (idle) {
      cancelAnimation(beat);
      beat.value = 0;
      return;
    }
    beat.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }),
        withDelay(BEAT_INTERVAL_MS, withTiming(0, { duration: 1 })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(beat);
  }, [idle, beat]);

  const shell = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(float.value, [0, 1], [0, -FLOAT_TRAVEL]) },
      { scale: interpolate(beat.value, [0, 1], [1, 1.07]) * (1 - press.value * 0.08) },
    ],
  }));

  // The halo rides the same beat, one step behind, so the pulse reads as
  // radiating outward rather than the whole button throbbing.
  const halo = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(float.value, [0, 1], [0, -FLOAT_TRAVEL]) },
      { scale: interpolate(beat.value, [0, 1], [1, 1.09]) },
    ],
  }));

  const nextAt = d.next_milestone?.at ?? d.daily_quota;
  const toGo = Math.max(0, nextAt - d.watched_today);

  return (
    <Animated.View style={[styles.wrap, { bottom, right }]} pointerEvents="box-none">
      {/* {!idle ? (
        <Animated.View
          style={[styles.halo,
            { backgroundColor: t.label + "26" },
            // { backgroundColor: t.scheme === "dark" ? "rgba(120,120,128,0.1)" : "#000" },
          halo]}
          pointerEvents="none"
        />
      ) : null} */}


      <Animated.View style={shell}>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/rewards" as never);
            }}
            onPressIn={() => {
              press.value = withSpring(1, { damping: 18, stiffness: 320 });
            }}
            onPressOut={() => {
              press.value = withSpring(0, { damping: 18, stiffness: 320 });
            }}
            accessibilityRole="button"
            accessibilityLabel={
              idle
                ? "Rewards. Daily limit reached."
                : `Earn rewards. ${toGo} ads to your next reward.`
            }
          >
            
          {!idle ? (
              <>
                <Animated.View
                  style={[styles.halo,
                    // { backgroundColor: t.label + "26" },
                    { backgroundColor: t.scheme === "dark" ? "rgba(120,120,128,0)" : "#000" },
                  halo]}
                pointerEvents="none">
                    <Glass
                      variant="regular"
                      interactive
                      radius={30}
                      style={[styles.button]}
                      fallbackIntensity={55}
                      fallbackTint={t.scheme === "dark" ? "rgba(120,120,128,0)" : "#000"}
                    >    
                      <FlameIcon active={d.current_streak === 0} colour={t.systemOrange + "92"} />
                </Glass>
                </Animated.View>
                <Text style={[styles.BottombadgeText, {color: t.label}]}>Daily Streak</Text>
              </>
            ) : null}
          </Pressable>

        {/* The count of watches still available. Sits above the glass, so its
            colour may change freely — it is not the glass itself. */}
        {!idle && toGo > 0 ? (
          <View style={[styles.badge, { backgroundColor: t.systemOrange  }]}>
            <Text style={[styles.badgeText, {color: t.label}]}>{toGo}</Text>
          </View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", alignItems: "center", justifyContent: "center", zIndex: 40 },
  halo: {  width: 60, height: 60, borderRadius: 30, flex: 1, alignItems: 'center', justifyContent: 'center' },
  button: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    // Glass clips, so the shadow cannot live on it — it goes on this style's
    // own container box, which is outside the clipped content.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    ...IOSAppFont.caption2,
    fontFamily: "Poppins_700Bold",
    fontSize: 11,
  },
  BottombadgeText: {
    // ...IOSAppFont.caption2,
    fontFamily: "Poppins_500Bold",
    fontSize: 11,
    alignSelf: 'center',
    justifyContent: 'center',
    marginTop: 3
  },
});
