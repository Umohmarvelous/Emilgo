// app/rewards/index.tsx
//
// The rewards hub: streak, today's ladder, the week, and where the money went.
//
// ── What this screen is for ─────────────────────────────────────────────────
// One question, answered above the fold: how many more ads until I get
// something, and what is it. Everything below that is evidence — the last seven
// days, the lifetime totals, the per-watch history including the ones that
// earned nothing and why.
//
// That last part is the difference between a rewards screen people trust and
// one they suspect. An abandoned watch appears in the list, greyed, saying
// "Closed early — no reward". Hiding failures is how users conclude the counter
// is lying to them.

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Image,
} from "react-native";
import { router, Stack, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  interpolate,
  cancelAnimation,
} from "react-native-reanimated";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  ArrowLeft01Icon,
  Fire02Icon,
  FuelStationIcon,
  Settings02Icon,
  InformationCircleIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";

import { Glass, useIOSTheme, IOSAppFont } from "@/components/ios";
import { AdMilestoneTrack } from "@/components/ads/AdMilestoneTrack";
import { AdTrackerSheet } from "@/components/ads/AdTrackerSheet";
import { useAdsStore } from "@/src/store/useAdsStore";
import { usePoolStore } from "@/src/store/usePoolStore";
import {
  listAdHistory,
  formatReward,
  formatClock,
  noRewardLabel,
  type AdHistoryRow,
} from "@/src/services/ads";

export default function RewardsScreen() {
  const t = useIOSTheme();
  const insets = useSafeAreaInsets();

  const d = useAdsStore((s) => s.dashboard);
  const loading = useAdsStore((s) => s.loading);
  const refresh = useAdsStore((s) => s.refresh);
  const loadPrefs = useAdsStore((s) => s.loadPrefs);
  const cooldownRemaining = useAdsStore((s) => s.cooldownRemaining);
  const poolBalance = usePoolStore((s) => s.balance);

  const [history, setHistory] = React.useState<AdHistoryRow[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [tracker, setTracker] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);

  // Refetch on focus, not just on mount: the user comes back here straight from
  // the player, and a stale count is the one thing this screen must never show.
  useFocusEffect(
    React.useCallback(() => {
      refresh();
      loadPrefs();
      listAdHistory(30).then(setHistory);
    }, [refresh, loadPrefs]),
  );

  // Tick the cooldown so the button becomes live on its own.
  React.useEffect(() => {
    const tick = () => setCooldown(cooldownRemaining());
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [cooldownRemaining, d.next_ad_at]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), listAdHistory(30).then(setHistory)]);
    setRefreshing(false);
  };

  const blocked = d.remaining_today <= 0;
  const waiting = cooldown > 0;

  const watch = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/rewards/watch" as never);
  };

  const toGo = d.next_milestone ? Math.max(0, d.next_milestone.at - d.watched_today) : 0;

  return (
    <View style={[styles.root, { backgroundColor: t.systemBackground }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            // Matches the floating header's height, so the spinner appears
            // below the bar rather than behind it.
            progressViewOffset={insets.top + 56}
            tintColor={t.tint}
          />
        }
      >
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <View style={styles.hero}>
          <View style={[styles.streakBadge, { backgroundColor: t.systemOrange + "1A" }]}>
            <FlameIcon active={d.current_streak > 0} colour={t.systemOrange} />
            <Text style={[styles.streakNum, { color: t.systemOrange }]}>{d.current_streak}</Text>
            <Text style={[styles.streakWord, { color: t.systemOrange }]}>
              day{d.current_streak === 1 ? "" : "s"}
            </Text>
          </View>

          <Text style={[styles.heroValue, { color: t.label }]}>{formatReward(poolBalance)}</Text>
          <Text style={[styles.heroLabel, { color: t.secondaryLabel }]}>
            in your fuel pool · {formatReward(d.earned_today)} earned today
          </Text>
        </View>

        {/* ── Today's ladder ───────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: t.secondarySystemBackground }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.cardTitle, { color: t.label }]}>{`Today's rewards`}</Text>
            <Pressable onPress={() => setTracker(true)} hitSlop={10} style={styles.info}>
              <HugeiconsIcon
                icon={InformationCircleIcon}
                size={17}
                color={t.tertiaryLabel}
                strokeWidth={2}
              />
            </Pressable>
          </View>

          <Text style={[styles.cardSub, { color: t.secondaryLabel }]}>
            {blocked
              ? "You've watched every ad available today. Goals reset at midnight."
              : d.next_milestone
                ? `${toGo} more ${toGo === 1 ? "ad" : "ads"} to earn ${formatReward(
                    d.next_milestone.naira,
                  )} — ${d.next_milestone.label}`
                : "Every goal cleared today. Nicely done."}
          </Text>

          <View style={styles.trackWrap}>
            <AdMilestoneTrack milestones={d.milestones} watched={d.watched_today} />
          </View>

          <Pressable
            onPress={watch}
            disabled={blocked || waiting}
            style={[
              styles.watchBtn,
              { backgroundColor: blocked || waiting ? t.tertiarySystemFill : t.tint },
            ]}
          >
            <HugeiconsIcon
              icon={PlayIcon}
              size={17}
              color={blocked || waiting ? t.tertiaryLabel : "#fff"}
              strokeWidth={2.4}
            />
            <Text
              style={[
                styles.watchText,
                { color: blocked || waiting ? t.tertiaryLabel : "#fff" },
              ]}
            >
              {blocked
                ? "Daily limit reached"
                : waiting
                  ? `Next ad in ${formatClock(cooldown)}`
                  : `Watch ads (${d.watched_today}/${d.daily_quota})`}
            </Text>
          </Pressable>

          <Text style={[styles.remaining, { color: t.tertiaryLabel }]}>
            {d.remaining_today} of {d.max_ads_per_day} watches left today ·{" "}
            {formatReward(d.reward_rewarded)} each
          </Text>
        </View>

        {/* ── The week ─────────────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: t.secondarySystemBackground }]}>
          <Text style={[styles.cardTitle, { color: t.label }]}>Last 7 days</Text>
          <WeekChart week={d.week} quota={d.daily_quota} />
          <View style={[styles.totals, { borderTopColor: t.separator }]}>
            <Total value={String(d.total_watched)} label="Ads watched" />
            <Total value={formatReward(d.total_earned)} label="Earned all time" />
            <Total value={String(d.longest_streak)} label="Best streak" />
          </View>
        </View>

        {/* ── History ──────────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: t.tertiaryLabel }]}>RECENT WATCHES</Text>
        {loading && !history.length ? (
          <ActivityIndicator color={t.tint} style={{ marginTop: 20 }} />
        ) : history.length ? (
          <View style={styles.history}>
            {history.map((h) => (
              <HistoryRow key={h.id} row={h} />
            ))}
          </View>
        ) : (
          <Text style={[styles.empty, { color: t.tertiaryLabel }]}>
            Nothing yet. Watch your first ad and it will show up here.
          </Text>
        )}
      </ScrollView>

      {/* ── Bar ──────────────────────────────────────────────────────────── */}
      <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + 56 }]}>
        <Glass
          variant="regular"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={60}
          fallbackTint={t.systemBackground}
        />
        <View style={styles.barRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={24} color={t.label} strokeWidth={2} />
          </Pressable>
          <Text style={[styles.barTitle, { color: t.label }]}>Rewards</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => router.push("/settings/ads" as never)}
            hitSlop={12}
            accessibilityLabel="Ad settings"
          >
            <HugeiconsIcon icon={Settings02Icon} size={21} color={t.label} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <AdTrackerSheet
        visible={tracker}
        onClose={() => setTracker(false)}
        dashboard={d}
        cooldown={cooldown}
        onWatch={() => {
          setTracker(false);
          watch();
        }}
      />
    </View>
  );
}

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
    <Animated.View style={style}>
      <HugeiconsIcon icon={Fire02Icon} size={17} color={colour} strokeWidth={2.2} />
    </Animated.View>
  );
}

function WeekChart({
  week,
  quota,
}: {
  week: { day: string; watched: number; earned: number; quota_met: boolean }[];
  quota: number;
}) {
  const t = useIOSTheme();
  // Scale to the tallest bar, never below the quota, so a light week does not
  // render as a row of full-height bars.
  const peak = Math.max(quota, ...week.map((w) => w.watched), 1);

  return (
    <View style={styles.week}>
      {week.map((w) => {
        const h = Math.max(3, (w.watched / peak) * 68);
        const label = new Date(w.day + "T00:00:00").toLocaleDateString("en-NG", {
          weekday: "narrow",
        });
        return (
          <View key={w.day} style={styles.weekCol}>
            <Text style={[styles.weekCount, { color: t.tertiaryLabel }]}>
              {w.watched || ""}
            </Text>
            <View style={[styles.weekTrack, { backgroundColor: t.tertiarySystemFill }]}>
              <View
                style={[
                  styles.weekBar,
                  { height: h, backgroundColor: w.quota_met ? t.tint : t.tint + "66" },
                ]}
              />
            </View>
            <Text style={[styles.weekDay, { color: t.tertiaryLabel }]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function HistoryRow({ row }: { row: AdHistoryRow }) {
  const t = useIOSTheme();
  const when = new Date(row.created_at).toLocaleString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });

  return (
    <View style={styles.historyRow}>
      {row.advertiser_logo ? (
        <Image source={{ uri: row.advertiser_logo }} style={styles.historyLogo} />
      ) : (
        <View style={[styles.historyLogo, { backgroundColor: t.tertiarySystemFill }]} />
      )}
      <View style={styles.historyText}>
        <Text style={[styles.historyName, { color: t.label }]} numberOfLines={1}>
          {row.advertiser_name}
        </Text>
        <Text style={[styles.historyMeta, { color: t.tertiaryLabel }]} numberOfLines={1}>
          {when} · {row.format}
        </Text>
      </View>
      {row.rewarded ? (
        <View style={styles.historyAmountWrap}>
          <HugeiconsIcon icon={FuelStationIcon} size={13} color={t.tint} strokeWidth={2} />
          <Text style={[styles.historyAmount, { color: t.tint }]}>
            +{formatReward(row.reward_amount)}
          </Text>
        </View>
      ) : (
        <Text style={[styles.historyNone, { color: t.tertiaryLabel }]} numberOfLines={1}>
          {noRewardLabel(row.no_reward_reason)}
        </Text>
      )}
    </View>
  );
}

function Total({ value, label }: { value: string; label: string }) {
  const t = useIOSTheme();
  return (
    <View style={styles.total}>
      <Text style={[styles.totalValue, { color: t.label }]}>{value}</Text>
      <Text style={[styles.totalLabel, { color: t.tertiaryLabel }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20, overflow: "hidden" },
  barRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  barTitle: { ...IOSAppFont.headline },

  hero: { alignItems: "center", paddingTop: 12, paddingBottom: 22, gap: 6 },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  streakNum: { ...IOSAppFont.subheadline, fontFamily: "Poppins_700Bold" },
  streakWord: { ...IOSAppFont.caption2 },
  heroValue: { fontFamily: "Poppins_700Bold", fontSize: 38, lineHeight: 46, marginTop: 6 },
  heroLabel: { ...IOSAppFont.footnote, textAlign: "center" },

  card: { marginHorizontal: 16, marginBottom: 14, borderRadius: 18, padding: 16, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { ...IOSAppFont.headline },
  cardSub: { ...IOSAppFont.footnote, lineHeight: 19 },
  info: { padding: 2 },
  trackWrap: { marginTop: 4 },

  watchBtn: {
    height: 50,
    borderRadius: 25,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 6,
  },
  watchText: { ...IOSAppFont.button, fontSize: 15 },
  remaining: { ...IOSAppFont.caption2, textAlign: "center" },

  week: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  weekCol: { alignItems: "center", flex: 1, gap: 5 },
  weekCount: { ...IOSAppFont.caption2, height: 13 },
  weekTrack: { width: 22, height: 68, borderRadius: 6, justifyContent: "flex-end", overflow: "hidden" },
  weekBar: { width: "100%", borderRadius: 6 },
  weekDay: { ...IOSAppFont.caption2 },

  totals: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    marginTop: 12,
  },
  total: { flex: 1, alignItems: "center", gap: 2 },
  totalValue: { ...IOSAppFont.headline },
  totalLabel: { ...IOSAppFont.caption2, textAlign: "center" },

  sectionTitle: { ...IOSAppFont.sectionTitle, marginHorizontal: 20, marginTop: 8, marginBottom: 6 },
  history: { marginHorizontal: 16, gap: 2 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  historyLogo: { width: 38, height: 38, borderRadius: 10 },
  historyText: { flex: 1, minWidth: 0, gap: 1 },
  historyName: { ...IOSAppFont.subheadline },
  historyMeta: { ...IOSAppFont.caption2, textTransform: "capitalize" },
  historyAmountWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  historyAmount: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },
  historyNone: { ...IOSAppFont.caption2, maxWidth: 120, textAlign: "right" },

  empty: { ...IOSAppFont.footnote, textAlign: "center", marginTop: 20, paddingHorizontal: 40 },
});
