// app/(main)/game.tsx
//
// The Game tab. Rendered by the (main) shell's tab switch, not as its own
// route screen.
//
// EMILGO Games lives here: Nigerian street games built as one web game that
// runs both inside Lagos Life (via the Vatar Games SDK) and here, embedded, so
// it works offline. Red Light, Green Light is the first; the others are listed
// as coming soon and are not tappable.
//
// Nothing in this tab touches money. Practice has no stakes, and the game's
// "fuel" in Danfo Dash is a score, never fuel coins.

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { Bus01Icon, Award01Icon } from "@hugeicons/core-free-icons";

import { Glass, IOSAppFont, IOSScreen, useIOSTheme } from "@/components/ios";
import { DanfoDash } from "@/components/game/DanfoDash";
import { Colors } from "@/constants/colors";
import { GAMES_STORAGE_PREFIX } from "@/src/games/emilgo-games/bridge";
import { haptics } from "@/src/utils/haptics";

const DANFO_BEST_KEY = "emilgo.game.danfoDash.best";
const REDLIGHT_SETTINGS_KEY = `${GAMES_STORAGE_PREFIX}settings.v1`;

const NAVY = "#16203c";
const GAMES_YELLOW = "#ffd700";

const COMING = [
  { emoji: "🎲", title: "Naija Ludo", line: "Roll, race, capture. 2–4 players." },
  { emoji: "🌰", title: "Ayo", line: "Sow seeds, count well, clear the board." },
  { emoji: "🦶", title: "Suwe", line: "Hop the chalk squares faster than everyone." },
];

interface RedLightStats {
  best: number;
  played: number;
  wins: number;
}

export default function GameTab() {
  const ios = useIOSTheme();
  const [danfoOpen, setDanfoOpen] = useState(false);
  const [danfoBest, setDanfoBest] = useState(0);
  const [rl, setRl] = useState<RedLightStats>({ best: 0, played: 0, wins: 0 });

  useEffect(() => {
    AsyncStorage.getItem(DANFO_BEST_KEY)
      .then((v) => setDanfoBest(Number(v) || 0))
      .catch(() => {});
  }, []);

  // The game writes its own stats; re-read them whenever the tab is shown again.
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(REDLIGHT_SETTINGS_KEY)
        .then((raw) => {
          if (!raw) return;
          const s = JSON.parse(raw) as Partial<RedLightStats>;
          setRl({ best: Number(s.best) || 0, played: Number(s.played) || 0, wins: Number(s.wins) || 0 });
        })
        .catch(() => {});
    }, []),
  );

  const onDanfoEnd = useCallback((score: number) => {
    setDanfoBest((prev) => {
      if (score <= prev) return prev;
      AsyncStorage.setItem(DANFO_BEST_KEY, String(score)).catch(() => {});
      return score;
    });
  }, []);

  const openRedLight = () => {
    haptics.press();
    // Cast until Metro regenerates the typed-routes file for the new screen.
    router.push("/games/redlight" as Href);
  };

  return (
    <IOSScreen title="Games">
      {/* ── EMILGO Games: featured ── */}
      <Pressable
        onPress={openRedLight}
        accessibilityRole="button"
        accessibilityLabel={`Play Red Light, Green Light. Best score ${rl.best}`}
        style={({ pressed }) => [styles.hero, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}
      >
        <View style={styles.heroTop}>
          <View>
            <Text style={styles.wordmark}>EMILGO</Text>
            <Text style={styles.wordmarkSub}>GAMES</Text>
          </View>
          <View style={styles.lights} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.lamp, { backgroundColor: "#ff2626" }]} />
            <View style={[styles.lamp, { backgroundColor: "#5c4a12" }]} />
            <View style={[styles.lamp, { backgroundColor: "#18e07a" }]} />
          </View>
        </View>

        <Text style={styles.heroTitle}>Red Light, Green Light</Text>
        <Text style={styles.heroLine}>
          Waka when Mama Gele sings. Freeze when she turns. Cross the line before time runs out.
        </Text>

        <View style={styles.chips}>
          <Text style={styles.chip}>Practice vs CPU</Text>
          <Text style={styles.chip}>Works offline</Text>
          <Text style={styles.chip}>No stakes</Text>
        </View>

        <View style={styles.heroBottom}>
          <View style={styles.stat}>
            <HugeiconsIcon icon={Award01Icon} size={15} color={GAMES_YELLOW} />
            <Text style={styles.statText}>{rl.best > 0 ? `Best ${rl.best}` : "No score yet"}</Text>
            {rl.played > 0 && <Text style={styles.statDim}> · crossed {rl.wins}/{rl.played}</Text>}
          </View>
          <View style={styles.playBtn}>
            <Text style={styles.playText}>▶ Play</Text>
          </View>
        </View>
      </Pressable>

      {/* ── Coming soon ── */}
      <Text style={[IOSAppFont.sectionTitle, styles.section, { color: ios.secondaryLabel }]}>COMING SOON</Text>
      <View style={styles.list}>
        <Glass
          variant="regular"
          radius={20}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={40}
          fallbackTint={ios.secondarySystemGroupedBackground}
        />
        {COMING.map((g, i) => (
          <View
            key={g.title}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ios.separator }]}
            accessibilityLabel={`${g.title}, coming soon`}
          >
            <Text style={styles.rowEmoji}>{g.emoji}</Text>
            <View style={styles.text}>
              <Text style={[IOSAppFont.label, { color: ios.label }]}>{g.title}</Text>
              <Text style={[IOSAppFont.description, { color: ios.secondaryLabel }]}>{g.line}</Text>
            </View>
            <Text style={styles.soon}>SOON</Text>
          </View>
        ))}
      </View>

      {/* ── Quick play ── */}
      <Text style={[IOSAppFont.sectionTitle, styles.section, { color: ios.secondaryLabel }]}>QUICK PLAY</Text>
      <Pressable
        onPress={() => {
          haptics.tap();
          setDanfoOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Play Danfo Dash. Best score ${danfoBest}`}
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
              {danfoBest > 0 ? `Best ${danfoBest}` : "No score yet"}
            </Text>
          </View>
        </View>
        <View style={[styles.play, { backgroundColor: Colors.primary }]}>
          <Text style={[IOSAppFont.label, { color: "#fff" }]}>Play</Text>
        </View>
      </Pressable>

      <DanfoDash visible={danfoOpen} best={danfoBest} onClose={() => setDanfoOpen(false)} onRunEnd={onDanfoEnd} />
    </IOSScreen>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginHorizontal: 13,
    marginTop: 8,
    padding: 18,
    borderRadius: 24,
    backgroundColor: NAVY,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  wordmark: { fontFamily: "Poppins_700Bold", fontSize: 24, color: GAMES_YELLOW, letterSpacing: 1.5, lineHeight: 26 },
  wordmarkSub: { fontFamily: "Poppins_700Bold", fontSize: 10, color: "#fff", letterSpacing: 5.5 },
  lights: { padding: 5, borderRadius: 10, backgroundColor: "#1d2124", gap: 4, borderWidth: 2, borderColor: "#ffd000" },
  lamp: { width: 14, height: 14, borderRadius: 7 },
  heroTitle: { fontFamily: "Poppins_700Bold", fontSize: 22, color: "#fff", marginTop: 4 },
  heroLine: { fontFamily: "Poppins_400Regular", fontSize: 13.5, lineHeight: 19, color: "rgba(255,255,255,0.78)" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 11.5,
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  heroBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  stat: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  statText: { fontFamily: "Poppins_600SemiBold", fontSize: 13, color: "#fff" },
  statDim: { fontFamily: "Poppins_400Regular", fontSize: 12, color: "rgba(255,255,255,0.6)" },
  playBtn: { backgroundColor: "#12b76a", paddingHorizontal: 20, height: 40, borderRadius: 20, justifyContent: "center" },
  playText: { fontFamily: "Poppins_700Bold", fontSize: 15, color: "#fff" },

  section: { marginHorizontal: 26, marginTop: 22, marginBottom: 8 },
  list: { marginHorizontal: 13, borderRadius: 20, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowEmoji: { fontSize: 26, width: 34, textAlign: "center" },
  soon: {
    fontFamily: "Poppins_700Bold",
    fontSize: 10,
    letterSpacing: 0.6,
    color: NAVY,
    backgroundColor: GAMES_YELLOW,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },

  card: {
    marginHorizontal: 13,
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
});
