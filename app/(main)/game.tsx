// app/(main)/game.tsx
//
// The Game tab. Rendered by the (main) shell's tab switch, not as its own
// route screen. Holds a list of games; Danfo Dash is the first.
//
// Best scores are per device (AsyncStorage). They are bragging rights, not
// rewards — see the note at the top of components/game/DanfoDash.tsx.

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { Bus01Icon, Award01Icon } from "@hugeicons/core-free-icons";

import { Glass, IOSAppFont, IOSScreen, useIOSTheme } from "@/components/ios";
import { DanfoDash } from "@/components/game/DanfoDash";
import { Colors } from "@/constants/colors";
import { haptics } from "@/src/utils/haptics";

const BEST_KEY = "emilgo.game.danfoDash.best";

export default function GameTab() {
  const ios = useIOSTheme();
  const [playing, setPlaying] = useState(false);
  const [best, setBest] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(BEST_KEY)
      .then((v) => setBest(Number(v) || 0))
      .catch(() => {});
  }, []);

  const onRunEnd = useCallback((score: number) => {
    setBest((prev) => {
      if (score <= prev) return prev;
      AsyncStorage.setItem(BEST_KEY, String(score)).catch(() => {});
      return score;
    });
  }, []);

  return (
    <IOSScreen title="Games">
      <Pressable
        onPress={() => {
          haptics.tap();
          setPlaying(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Play Danfo Dash. Best score ${best}`}
        style={({ pressed }) => [styles.card, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
      >
        <Glass
          variant="regular"
          radius={22}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={40}
          fallbackTint={ios.secondarySystemGroupedBackground}
        />
        <View style={styles.art}>
          <HugeiconsIcon icon={Bus01Icon} size={34} color="#1A1A1A" strokeWidth={2} />
        </View>
        <View style={styles.text}>
          <Text style={[IOSAppFont.label, { color: ios.label, fontSize: 17 }]}>Danfo Dash</Text>
          <Text style={[IOSAppFont.description, { color: ios.secondaryLabel }]}>
            Weave through traffic, dodge okadas, grab fuel.
          </Text>
          <View style={styles.bestRow}>
            <HugeiconsIcon icon={Award01Icon} size={15} color={Colors.gold} />
            <Text style={[IOSAppFont.description, { color: ios.secondaryLabel, marginTop: 0 }]}>
              {best > 0 ? `Best ${best}` : "No score yet"}
            </Text>
          </View>
        </View>
        <View style={[styles.play, { backgroundColor: Colors.primary }]}>
          <Text style={[IOSAppFont.label, { color: "#fff" }]}>Play</Text>
        </View>
      </Pressable>

      <Text style={[IOSAppFont.description, styles.more, { color: ios.tertiaryLabel }]}>
        More games coming soon.
      </Text>

      <DanfoDash
        visible={playing}
        best={best}
        onClose={() => setPlaying(false)}
        onRunEnd={onRunEnd}
      />
    </IOSScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 13,
    marginTop: 8,
    padding: 14,
    borderRadius: 22,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  art: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: "#FFD60A",
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1 },
  bestRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  play: { paddingHorizontal: 16, height: 34, borderRadius: 17, justifyContent: "center" },
  more: { textAlign: "center", marginTop: 24 },
});
