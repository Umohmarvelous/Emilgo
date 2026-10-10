// app/rewards/watch.tsx
//
// The ad player. Full-screen, one ad at a time, with a real countdown.
//
// ── Three states, one screen ────────────────────────────────────────────────
//   playing  → the creative, a progress bar, a skip/close control, a reaction.
//   reward   → what was just earned, and what it unlocked.
//   install  → the post-roll card, if the ad promotes an app.
//
// ── The countdown is display only ──────────────────────────────────────────
// The bar here is a local timer for the user's benefit. It decides nothing.
// Whether the ad counted is settled by `complete_ad_session`, which compares
// the database's own `started_at` to the database's own `now()`. If this timer
// were wrong — a paused JS thread, a backgrounded app, a patched build — the
// server would still give the same verdict. That is why it is safe for the
// timer to be simple.
//
// ── Closing early ──────────────────────────────────────────────────────────
// The user is told what it costs BEFORE it costs them. A confirm dialog naming
// the actual amount, then either the ad continues or the session is abandoned
// and nothing is paid. Silently forfeiting a reward is the single most
// resented thing a rewarded-ad player can do.

import React from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  BackHandler,
  AppState,
} from "react-native";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { useVideoPlayer, VideoView } from "expo-video";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withSpring,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  Cancel01Icon,
  ThumbsDownIcon,
  VolumeHighIcon,
  VolumeMute01Icon,
  Tick02Icon,
  Fire02Icon,
  FuelStationIcon,
} from "@hugeicons/core-free-icons";

import { Glass, iosAlert, iosActionSheet, useIOSTheme, IOSAppFont, IOSButton } from "@/components/ios";
import { AdInstallCard } from "@/components/ads/AdInstallCard";
import { useAdsStore } from "@/src/store/useAdsStore";
import {
  nextAd,
  startAdSession,
  startNetworkAdSession,
  abandonAdSession,
  suppressAd,
  reportAd,
  formatReward,
  type AdCreative,
  type AdCompletion,
  type NoAdReason,
} from "@/src/services/ads";
import {
  isAdMobAvailable,
  initAdMob,
  loadRewarded,
  showRewarded,
  isRewardedReady,
  loadInterstitial,
  showInterstitial,
  isInterstitialReady,
} from "@/src/services/admob";

type Phase = "loading" | "playing" | "settling" | "reward" | "install" | "empty";

export default function WatchAdScreen() {
  const t = useIOSTheme();
  const insets = useSafeAreaInsets();
  const { format } = useLocalSearchParams<{ format?: string }>();

  const settle = useAdsStore((s) => s.settle);
  const prefs = useAdsStore((s) => s.prefs);
  const dashboard = useAdsStore((s) => s.dashboard);

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [ad, setAd] = React.useState<AdCreative | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [reward, setReward] = React.useState<number>(0);
  const [result, setResult] = React.useState<AdCompletion | null>(null);
  const [emptyReason, setEmptyReason] = React.useState<NoAdReason>("no_inventory");
  const [elapsed, setElapsed] = React.useState(0);
  const [muted, setMuted] = React.useState(!prefs?.sound_on);

  const adFormat = (format as any) || "rewarded";
  const duration = ad?.duration_seconds ?? 0;
  const remaining = Math.max(0, duration - elapsed);
  const canSkip =
    ad?.skip_after_seconds != null && elapsed >= ad.skip_after_seconds;

  // ── Video ────────────────────────────────────────────────────────────────
  const player = useVideoPlayer(
    ad?.media_type === "video" && ad.media_url ? ad.media_url : null,
    (p) => {
      p.loop = false;
      p.muted = muted;
      p.play();
    },
  );

  React.useEffect(() => {
    try {
      player.muted = muted;
    } catch {}
  }, [muted, player]);

  /**
   * Hand the slot to AdMob.
   *
   * The network renders its own full-screen player, so this screen has nothing
   * to draw while it runs — the phase stays "settling" and the SDK is on top.
   *
   * `earned` from the SDK is a CLAIM, not a payment. The session is still
   * settled by `complete_ad_session`, which compares the database's own clock to
   * its own `started_at`. A spoofed SDK can at most cause a session to be
   * attempted; it cannot mint a payout.
   *
   * Returns true when the network filled the slot (whether or not it paid), so
   * the caller knows not to fall through to the empty state.
   */
  const playNetworkAd = React.useCallback(
    async (format: "rewarded" | "interstitial"): Promise<boolean> => {
      if (!isAdMobAvailable()) return false;

      await initAdMob();

      const ready = format === "rewarded" ? isRewardedReady() : isInterstitialReady();
      if (!ready) {
        const loaded = format === "rewarded" ? await loadRewarded() : await loadInterstitial();
        if (!loaded.ok) return false;
      }

      let id: string;
      try {
        id = await startNetworkAdSession(format);
      } catch (e: any) {
        console.warn("[watch] start network session:", e?.message);
        return false;
      }

      setSessionId(id);
      setAd(null);
      setPhase("settling");

      const shown = format === "rewarded" ? await showRewarded() : await showInterstitial();

      if (!shown.ok && shown.reason === "not_loaded") {
        abandonAdSession(id);
        return false;
      }

      try {
        // The store's `settle`, not the raw RPC: it also refreshes the
        // dashboard, so the streak and ladder on the way out are current.
        const res = await settle(id);
        setResult(res);
        setPhase("reward");
      } catch (e: any) {
        console.warn("[watch] settle network session:", e?.message);
        setEmptyReason("no_inventory");
        setPhase("empty");
      }
      return true;
    },
    [settle],
  );

  // ── Load one ad ──────────────────────────────────────────────────────────
  //
  // Direct partners first, the ad network as the fallback. A partner has already
  // paid for their impressions; AdMob takes a cut of ours. Burning owned
  // inventory before rented inventory is worth real money and costs nothing.
  const load = React.useCallback(async () => {
    setPhase("loading");
    setElapsed(0);
    setResult(null);

    const res = await nextAd(adFormat);

    if (res.ok) {
      try {
        const id = await startAdSession(res.ad.id);
        setAd(res.ad);
        setReward(res.reward);
        setSessionId(id);
        setPhase("playing");
      } catch (e: any) {
        iosAlert("Could not start", e?.message ?? "Please try again.");
        router.back();
      }
      return;
    }

    // A daily limit or a cooldown is a rule, not an absence of stock — going to
    // the network would be a way of paying someone to break our own rule.
    if (res.reason !== "no_inventory") {
      setEmptyReason(res.reason);
      setPhase("empty");
      return;
    }

    if (adFormat === "rewarded" || adFormat === "interstitial") {
      const filled = await playNetworkAd(adFormat);
      if (filled) return;
    }

    setEmptyReason("no_inventory");
    setPhase("empty");
  }, [adFormat, playNetworkAd]);

  React.useEffect(() => {
    load();
  }, [load]);

  // ── The countdown ────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (phase !== "playing") return;
    const h = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(h);
  }, [phase]);

  // Backgrounding the app pauses the video but not this timer, so a user could
  // switch away and come back to a "finished" ad. The server would refuse it —
  // but the honest thing is to pause here too, so the bar matches reality.
  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        try {
          player.pause();
        } catch {}
      } else if (phase === "playing") {
        try {
          player.play();
        } catch {}
      }
    });
    return () => sub.remove();
  }, [player, phase]);

  React.useEffect(() => {
    if (phase === "playing" && duration > 0 && elapsed >= duration) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, duration, phase]);

  // ── Settle ───────────────────────────────────────────────────────────────
  const finish = async () => {
    if (!sessionId) return;
    setPhase("settling");
    try {
      const r = await settle(sessionId);
      setResult(r);
      if (r.rewarded) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setPhase("reward");
    } catch (e: any) {
      iosAlert("Could not confirm", e?.message ?? "Your reward may not have been recorded.");
      setPhase("reward");
    }
  };

  // ── Leaving early ────────────────────────────────────────────────────────
  const confirmClose = React.useCallback(() => {
    if (phase !== "playing") {
      router.back();
      return true;
    }
    iosAlert(
      "Close this ad?",
      `You need ${remaining} more second${remaining === 1 ? "" : "s"} to earn ${formatReward(
        reward,
      )}. Closing now means you get nothing for this one.`,
      [
        { text: "Keep watching", style: "cancel" },
        {
          text: "Close and lose it",
          style: "destructive",
          onPress: () => {
            if (sessionId) abandonAdSession(sessionId);
            router.back();
          },
        },
      ],
    );
    return true;
  }, [phase, remaining, reward, sessionId]);

  // Android's hardware back must go through the same warning.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", confirmClose);
    return () => sub.remove();
  }, [confirmClose]);

  // ── Reactions ────────────────────────────────────────────────────────────
  const react = () => {
    if (!ad) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    iosActionSheet("Not interested?", "This helps us pick better ads for you.", [
      {
        text: "Hide this ad",
        onPress: () =>
          suppressAd(ad.id, "creative", "not_interested").catch(() => {}),
      },
      {
        text: `Stop showing me ${ad.category} ads`,
        onPress: () => suppressAd(ad.id, "category", "category_muted").catch(() => {}),
      },
      {
        text: "Report this ad",
        style: "destructive" as const,
        onPress: () =>
          iosActionSheet("Report this ad", "What is wrong with it?", [
            ...["Inappropriate", "Misleading", "Scam or fraud", "Offensive", "Repetitive"].map(
              (r) => ({
                text: r,
                onPress: () => {
                  reportAd(ad.id, r.toLowerCase().replace(/\s+/g, "_")).catch(() => {});
                  iosAlert("Thank you", "We will review this ad.");
                },
              }),
            ),
            { text: "Cancel", style: "cancel" as const },
          ]),
      },
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  // ═══════════════════════════════════════════════════════════════════════════

  if (phase === "empty") {
    return <EmptyState reason={emptyReason} onClose={() => router.back()} />;
  }

  if (phase === "install" && ad) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="auto" />
        <AdInstallCard
          ad={ad}
          sessionId={sessionId}
          canContinue={dashboard.remaining_today > 0}
          onNext={load}
          onDone={() => router.back()}
        />
      </View>
    );
  }

  if (phase === "reward" && result) {
    return (
      <RewardState
        result={result}
        hasInstall={!!(ad?.app_store_url || ad?.play_store_url)}
        canContinue={dashboard.remaining_today > 0}
        onInstall={() => setPhase("install")}
        onNext={load}
        onDone={() => router.back()}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: "#000" }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />

      {/* ── The creative ──────────────────────────────────────────────────── */}
      {phase === "loading" || !ad ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.loadingText}>Finding an ad…</Text>
        </View>
      ) : ad.media_type === "video" && ad.media_url ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={false}
        />
      ) : ad.media_url ? (
        <Image source={{ uri: ad.media_url }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      ) : (
        <View style={[styles.center, styles.fallbackCreative]}>
          <Text style={styles.fallbackHeadline}>{ad.headline}</Text>
          <Text style={styles.fallbackBody}>{ad.body}</Text>
        </View>
      )}

      {/* ── Top chrome ────────────────────────────────────────────────────── */}
      {ad ? (
        <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
          <CountdownBar elapsed={elapsed} duration={duration} />

          <View style={styles.topRow}>
            <View style={styles.adBadge}>
              <Text style={styles.adBadgeText}>Ad · {ad.advertiser_name}</Text>
            </View>

            <View style={styles.topActions}>
              {ad.media_type === "video" ? (
                <CircleButton
                  icon={muted ? VolumeMute01Icon : VolumeHighIcon}
                  onPress={() => setMuted((m) => !m)}
                  label={muted ? "Unmute" : "Mute"}
                />
              ) : null}
              <CircleButton icon={ThumbsDownIcon} onPress={react} label="Not interested" />

              {/* The counter becomes a close button the moment skipping is
                  allowed — the same affordance the user is already staring at,
                  rather than a second control appearing from nowhere. */}
              {canSkip || phase !== "playing" ? (
                <CircleButton icon={Cancel01Icon} onPress={confirmClose} label="Close" />
              ) : (
                <View style={styles.counter}>
                  <Text style={styles.counterText}>{String(remaining).padStart(2, "0")}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      ) : null}

      {/* ── Bottom: what this is worth ────────────────────────────────────── */}
      {ad ? (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 18 }]}>
          <View style={styles.rewardPill}>
            <HugeiconsIcon icon={FuelStationIcon} size={15} color="#fff" strokeWidth={2} />
            <Text style={styles.rewardPillText}>
              {remaining > 0
                ? `${formatReward(reward)} in ${remaining}s`
                : "Confirming your reward…"}
            </Text>
          </View>
          {ad.skip_after_seconds != null && !canSkip ? (
            <Text style={styles.skipHint}>
              You can close in {Math.max(0, ad.skip_after_seconds - elapsed)}s — but you would lose
              the reward
            </Text>
          ) : null}
        </View>
      ) : null}

      {phase === "settling" ? (
        <View style={styles.settling}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════

/** The timer. Width only — never opacity, and nothing here sits on glass. */
function CountdownBar({ elapsed, duration }: { elapsed: number; duration: number }) {
  const w = useSharedValue(0);
  const fraction = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  React.useEffect(() => {
    // Linear over exactly one second, so the bar advances at the same rate the
    // clock does instead of easing and appearing to stall.
    w.value = withTiming(fraction, { duration: 1000, easing: Easing.linear });
  }, [fraction, w]);

  const style = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));

  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.barFill, style]} />
    </View>
  );
}

function CircleButton({
  icon,
  onPress,
  label,
}: {
  icon: any;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={styles.circle}>
      <HugeiconsIcon icon={icon} size={17} color="#fff" strokeWidth={2.2} />
    </Pressable>
  );
}

/** The celebration. */
function RewardState({
  result,
  hasInstall,
  canContinue,
  onInstall,
  onNext,
  onDone,
}: {
  result: AdCompletion;
  hasInstall: boolean;
  canContinue: boolean;
  onInstall: () => void;
  onNext: () => void;
  onDone: () => void;
}) {
  const t = useIOSTheme();
  const insets = useSafeAreaInsets();
  const pop = useSharedValue(0);

  React.useEffect(() => {
    pop.value = withSpring(1, { damping: 12, stiffness: 180 });
  }, [pop]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const failed = !result.rewarded;

  return (
    <View style={[styles.root, { backgroundColor: t.systemBackground }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.center, { paddingHorizontal: 32 }]}>
        <Animated.View style={popStyle}>
          <View
            style={[
              styles.rewardMark,
              { backgroundColor: failed ? t.systemOrange + "22" : t.tint + "22" },
            ]}
          >
            <HugeiconsIcon
              icon={failed ? Cancel01Icon : Tick02Icon}
              size={40}
              color={failed ? t.systemOrange : t.tint}
              strokeWidth={2.5}
            />
          </View>
        </Animated.View>

        {failed ? (
          <>
            <Text style={[styles.rewardTitle, { color: t.label }]}>No reward this time</Text>
            <Text style={[styles.rewardSub, { color: t.secondaryLabel }]}>
              {result.reason === "too_short"
                ? `You watched ${result.watched_seconds ?? 0}s of the ${
                    result.required_seconds ?? 0
                  }s needed.`
                : result.reason === "daily_limit"
                  ? "You have reached today's limit. Come back tomorrow."
                  : "That watch could not be confirmed."}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.rewardAmount, { color: t.tint }]}>
              +{formatReward(result.total_credited)}
            </Text>
            <Text style={[styles.rewardTitle, { color: t.label }]}>Added to your fuel pool</Text>

            <View style={styles.breakdown}>
              <Line label="This ad" value={formatReward(result.reward)} />
              {result.milestone_bonus > 0 ? (
                <Line
                  label={result.milestone_label || "Goal reached"}
                  value={formatReward(result.milestone_bonus)}
                  highlight
                />
              ) : null}
              {result.streak_bonus > 0 ? (
                <Line
                  label={`${result.streak}-day streak bonus`}
                  value={formatReward(result.streak_bonus)}
                  highlight
                />
              ) : null}
            </View>

            <Text style={[styles.rewardSub, { color: t.secondaryLabel }]}>
              {result.watched_today} of {result.daily_quota} today
              {result.quota_met_now ? " · daily goal cleared" : ""}
            </Text>

            {result.quota_met_now ? (
              <View style={[styles.streakChip, { backgroundColor: t.systemOrange + "1A" }]}>
                <HugeiconsIcon icon={Fire02Icon} size={15} color={t.systemOrange} strokeWidth={2} />
                <Text style={[styles.streakChipText, { color: t.systemOrange }]}>
                  {result.streak} day streak
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      <View style={[styles.rewardActions, { paddingBottom: insets.bottom + 20 }]}>
        {hasInstall && !failed ? (
          <Pressable onPress={onInstall} style={[styles.primary, { backgroundColor: t.tint }]}>
            <Text style={styles.primaryText}>See the app</Text>
          </Pressable>
        ) : null}
        {canContinue ? (
          <Pressable onPress={onNext} style={[styles.ghostWide, { borderColor: t.separator }]}>
            <Text style={[styles.ghostWideText, { color: t.label }]}>Watch another</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onDone} style={styles.plain}>
          <Text style={[styles.plainText, { color: t.secondaryLabel }]}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Line({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const t = useIOSTheme();
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, { color: highlight ? t.tint : t.secondaryLabel }]}>
        {label}
      </Text>
      <Text style={[styles.lineValue, { color: highlight ? t.tint : t.label }]}>{value}</Text>
    </View>
  );
}

/** Nothing to play, and why. Each reason gets its own sentence and its own fix. */
function EmptyState({ reason, onClose }: { reason: NoAdReason; onClose: () => void }) {
  const t = useIOSTheme();
  const copy: Record<NoAdReason, { title: string; body: string }> = {
    daily_limit: {
      title: "That's all for today",
      body: "You have watched every ad available to you today. Your goals reset at midnight.",
    },
    cooldown: {
      title: "Just a moment",
      body: "There is a short wait between ads. Try again in a few seconds.",
    },
    no_inventory: {
      title: "No ads right now",
      body: "There are no ads available for you at the moment. Check back a little later.",
    },
    offline: {
      title: "You're offline",
      body: "Ads need a connection. Your streak and rewards are safe — try again when you are back online.",
    },
  };
  const c = copy[reason];

  return (
    <View style={[styles.root, { backgroundColor: t.systemBackground }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.center, { paddingHorizontal: 40 }]}>
        <Text style={[styles.rewardTitle, { color: t.label }]}>{c.title}</Text>
        <Text style={[styles.rewardSub, { color: t.secondaryLabel }]}>{c.body}</Text>

        <IOSButton
            title={"Close"}
            variant="filled"
            onPress={onClose}
            disabled={false}
            style={{ ...IOSAppFont.button, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", alignSelf:'center' }}
          />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { ...IOSAppFont.footnote, color: "rgba(255,255,255,0.7)", marginTop: 12 },

  fallbackCreative: { paddingHorizontal: 40 },
  fallbackHeadline: {
    ...IOSAppFont.title2,
    color: "#fff",
    textAlign: "center",
  },
  fallbackBody: {
    ...IOSAppFont.subheadline,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    marginTop: 8,
  },

  top: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 14, gap: 12 },
  bar: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.22)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 2, backgroundColor: "#fff" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  adBadge: {
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    maxWidth: "55%",
  },
  adBadgeText: { ...IOSAppFont.caption2, color: "rgba(255,255,255,0.9)" },
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  circle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  counter: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: { ...IOSAppFont.caption1, color: "#fff", fontFamily: "Poppins_600SemiBold" },

  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", gap: 8 },
  rewardPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  rewardPillText: { ...IOSAppFont.footnote, color: "#fff" },
  skipHint: {
    ...IOSAppFont.caption2,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    paddingHorizontal: 30,
  },

  settling: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },

  rewardMark: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  rewardAmount: { fontFamily: "Poppins_700Bold", fontSize: 40, lineHeight: 48, marginTop: 18 },
  rewardTitle: { ...IOSAppFont.title3, textAlign: "center", marginTop: 6 },
  rewardSub: { ...IOSAppFont.footnote, textAlign: "center", marginTop: 6, lineHeight: 19 },

  breakdown: { width: "100%", marginTop: 18, gap: 8 },
  line: { flexDirection: "row", justifyContent: "space-between" },
  lineLabel: { ...IOSAppFont.footnote },
  lineValue: { ...IOSAppFont.footnote, fontFamily: "Poppins_600SemiBold" },

  streakChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 14,
  },
  streakChipText: { ...IOSAppFont.caption1, fontFamily: "Poppins_600SemiBold" },

  rewardActions: { paddingHorizontal: 24, gap: 10 },
  primary: { height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  primaryText: { ...IOSAppFont.button, color: "#fff", fontSize: 16 },
  ghostWide: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostWideText: { ...IOSAppFont.button, fontSize: 15 },
  plain: { height: 40, alignItems: "center", justifyContent: "center" },
  plainText: { ...IOSAppFont.footnote },
});
