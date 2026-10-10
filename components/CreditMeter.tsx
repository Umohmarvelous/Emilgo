// components/CreditMeter.tsx
//
// Profile dashboard header: the user's engagement-credit balance, their loyalty
// tier (Bronze/Silver/Gold), and an animated progress bar toward the next tier.
// Reanimated drives both the bar fill and the count-up of the number.

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { Star } from "@hugeicons/core-free-icons";
import { Colors } from "@/constants/colors";
import { useCreditsStore } from "@/src/store/useCreditsStore";
import { creditTier, tierProgress, creditsToNextTier } from "@/src/utils/tiers";

export default function CreditMeter({
  textColor,
  subColor,
  cardBg,
}: {
  textColor: string;
  subColor: string;
  cardBg: string;
}) {
  const credits = useCreditsStore((s) => s.balance);
  const tier = creditTier(credits);
  const progress = tierProgress(credits);
  const toNext = creditsToNextTier(credits);

  // Animate the bar fill toward the current progress.
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(progress, { duration: 700, easing: Easing.out(Easing.cubic) });
  }, [progress, fill]);
  const barStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  // Count the number up on change.
  const [display, setDisplay] = useState(credits);
  useEffect(() => {
    let raf = 0;
    const from = display;
    const to = credits;
    const start = Date.now();
    const dur = 700;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      setDisplay(Math.round(from + (to - from) * t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credits]);

  return (
    <View style={[styles.card]}>
      <View style={[styles.iconBadge]}>
        <HugeiconsIcon icon={Star as any} size={18} color={textColor} fill={textColor} />
        <Text style={[styles.creditsLabel, { color: textColor }]}>Credits Status   
        </Text>
        <View style={[styles.tierDot, { backgroundColor: textColor }]} />

        <View style={styles.creditWrap}>
          <View style={{flexDirection: 'column', alignItems: 'center', gap: 10}}>
            <View style={[styles.tierPill,
              { backgroundColor: tier.color + "22" }
            ]}>
              {/* <View style={[styles.tierDot, { backgroundColor: tier.color }]} /> */}
              <Text style={[styles.tierName, { color: tier.color }]}>{tier.name}</Text>
            </View>
          </View>
        </View>
      </View>
          

      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: tier.color }, barStyle]} />
      </View>


      <View style={styles.headerRow}>
        {/* {tier.next == null ? */}
          <View style={{ flexDirection: 'row', alignItems:'center', justifyContent: 'center', gap: 5}}>
            <Text style={[styles.credits, { color: textColor }]}>
              {display.toLocaleString("en-NG")} 
            </Text>
            <View style={{ flexDirection: 'row', alignItems:'center', justifyContent: 'center', gap: 5}}>
              <Text style={{ color: subColor }}>/</Text>
              
              <Text style={[styles.hint, { color: subColor }]}>
              {tier.next == null
                ? "You've reached Top tier"
                : `${toNext.toLocaleString("en-NG")} more credits to ${
                    creditTier(tier.next).name
                  }`}
              </Text>
            </View>
          </View>
        {/* : null} */}
      </View>

      {/* <Text style={[styles.hint, { color: subColor }]}>
        {tier.next == null
          ? "Top tier reached — you're Gold"
          : `${toNext.toLocaleString("en-NG")} more credits to ${
              creditTier(tier.next).name
            }`}
      </Text> */}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 25,
    marginBottom: 10,
    gap: 0, 
    shadowColor: "#000",
    shadowOffset: { width: 1, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 0,
    elevation: 2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  creditWrap: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBadge: {
    // width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "flex-start",
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: 10,    marginBottom: 15,

  },
  credits: { fontFamily: "Poppins_700Bold", fontSize: 14, lineHeight: 26 },
  creditsLabel: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 12
   },
  tierPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 3,
    borderRadius: 5,
  },
  tierDot: { width: 5, height: 5, borderRadius: 4, marginHorizontal: 5 },
  tierName: { fontFamily: "Poppins_600SemiBold", fontSize: 13 },
  track: {
    height: 10,
    borderRadius: 6,
    backgroundColor: Colors.overlayLight,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 6 },
  hint: { fontFamily: "Poppins_400Regular", fontSize: 12 },
});
