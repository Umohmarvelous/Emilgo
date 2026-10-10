// app/(auth)/provisioning.tsx
//
// The screen between "Create account" and the app.

import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
  interpolate,
  cancelAnimation,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  Tick02Icon,
  Alert02Icon,
  UserIcon,
  Coins01Icon,
  FuelStationIcon,
  Megaphone01Icon,
  CloudIcon,
} from "@hugeicons/core-free-icons";

import { useIOSTheme, IOSAppFont } from "@/components/ios";
import { supabase } from "@/src/services/supabase";
import { useAuthStore } from "@/src/store/useStore";
import { useCreditsStore } from "@/src/store/useCreditsStore";
import { usePoolStore } from "@/src/store/usePoolStore";
import { getAdPreferences } from "@/src/services/ads";
import { triggerSyncNow } from "@/src/services/sync";
import { Colors } from "@/constants/colors";

type StepState = "waiting" | "running" | "done" | "failed";

interface Step {
  key: string;
  label: string;
  running: string;
  icon: any;
  run: (userId: string) => Promise<void>;
}

const STEPS: Step[] = [
  {
    key: "profile",
    label: "Your profile",
    running: "Creating your profile",
    icon: UserIcon,
    run: async (userId) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const { data } = await supabase
          .from("users")
          .select("id")
          .eq("id", userId)
          .maybeSingle();
        if (data?.id) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("profile row never appeared");
    },
  },
  {
    key: "credits",
    label: "Welcome bonus",
    running: "Adding your sign-up credits",
    icon: Coins01Icon,
    run: async (userId) => {
      await useCreditsStore.getState().addCredit("signup", 10, userId);
    },
  },
  {
    key: "pool",
    label: "Fuel pool",
    running: "Opening your fuel pool",
    icon: FuelStationIcon,
    run: async (userId) => {
      await usePoolStore.getState().pullPool(userId);
    },
  },
  {
    key: "ads",
    label: "Reward settings",
    running: "Setting your reward preferences",
    icon: Megaphone01Icon,
    run: async () => {
      await getAdPreferences();
    },
  },
  {
    key: "sync",
    label: "Sync",
    running: "Syncing your account",
    icon: CloudIcon,
    run: async () => {
      await triggerSyncNow();
    },
  },
];

export default function ProvisioningScreen() {
  const t = useIOSTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  const [states, setStates] = React.useState<Record<string, StepState>>(
    () => Object.fromEntries(STEPS.map((s) => [s.key, "waiting"])),
  );
  const [failed, setFailed] = React.useState<string[]>([]);
  const [finished, setFinished] = React.useState(false);

  const done = STEPS.filter((s) => states[s.key] === "done" || states[s.key] === "failed").length;
  const progress = done / STEPS.length;

  const running = STEPS.find((s) => states[s.key] === "running");

  React.useEffect(() => {
    if (!user?.id) return;
    let alive = true;

    (async () => {
      const bad: string[] = [];
      for (const step of STEPS) {
        if (!alive) return;
        setStates((s) => ({ ...s, [step.key]: "running" }));
        try {
          await step.run(user.id);
          if (!alive) return;
          setStates((s) => ({ ...s, [step.key]: "done" }));
          Haptics.selectionAsync();
        } catch (e: any) {
          console.warn(`[provisioning] ${step.key}:`, e?.message ?? e);
          if (!alive) return;
          bad.push(step.key);
          setStates((s) => ({ ...s, [step.key]: "failed" }));
        }
      }
      if (!alive) return;
      setFailed(bad);
      setFinished(true);
      Haptics.notificationAsync(
        bad.length
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
      );
    })();

    return () => {
      alive = false;
    };
  }, [user?.id]);

  React.useEffect(() => {
    if (!finished) return;
    const h = setTimeout(() => {
      const next = user?.role === "driver" ? "/(auth)/driver-profile" : "/(main)";
      router.replace(next as never);
    }, 900);
    return () => clearTimeout(h);
  }, [finished, user?.role]);

  return (
    <View style={[styles.root, { backgroundColor: t.systemBackground }]}>
      <View
        style={[
          styles.body,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <PulsingMark tint={t.tint} finished={finished} failedCount={failed.length} />

        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: t.label }]}>
            {finished ? "You're all set" : "Setting up your account"}
          </Text>
          <Text style={[styles.blurb, { color: t.secondaryLabel }]}>
            {finished
              ? failed.length
                ? "A couple of things will finish in the background."
                : "Everything is ready. Taking you in…"
              : running
                ? `${running.running}…`
                : "This takes a few seconds. Please hold on."}
          </Text>
        </View>

        <View style={styles.metrics}>
          <Text style={[styles.percent, { color: t.tint }]}>{Math.round(progress * 100)}%</Text>
          <Text style={[styles.metricSub, { color: t.tertiaryLabel }]}>
            {done} of {STEPS.length} steps
          </Text>
        </View>

        <ProgressTrack progress={progress} tint={t.tint} track={t.tertiarySystemFill} />

        <View style={styles.steps}>
          {STEPS.map((step, i) => (
            <StepRow key={step.key} step={step} state={states[step.key]} index={i} />
          ))}
        </View>
      </View>
    </View>
  );
}

function PulsingMark({ tint, finished, failedCount }: { tint: string; finished: boolean; failedCount: number; }) {
  const t = useIOSTheme();
  const ok = finished && failedCount === 0;

  return (
    <View style={styles.markWrap}>
      <View style={[styles.mark, { backgroundColor: tint + "20" }]}>
        <HugeiconsIcon
          icon={ok ? Tick02Icon : finished ? Alert02Icon : UserIcon}
          size={36}
          color={finished && failedCount ? t.systemOrange : tint}
          strokeWidth={2}
        />
      </View>
    </View>
  );
}

function ProgressTrack({ progress, tint, track }: { progress: number; tint: string; track: string; }) {
  const w = useSharedValue(0);

  React.useEffect(() => {
    w.value = withTiming(progress, { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [progress, w]);

  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));

  return (
    <View style={[styles.track, { backgroundColor: track }]}>
      <Animated.View style={[styles.fill, { backgroundColor: tint }, fill]} />
    </View>
  );
}

function StepRow({ step, state, index }: { step: Step; state: StepState; index: number; }) {
  const t = useIOSTheme();
  
  const colour =
    state === "done"
      ? t.tint
      : state === "failed"
        ? t.systemOrange
        : state === "running"
          ? t.label
          : t.quaternaryLabel;

  return (
    <View style={styles.step}>
      <View style={[styles.stepIcon, { borderColor: colour + "44" }]}>
        {state === "running" ? (
          <ActivityIndicator size="small" color={colour} style={{ transform: [{ scale: 0.8 }] }} />
        ) : (
          <HugeiconsIcon
            icon={state === "done" ? Tick02Icon : state === "failed" ? Alert02Icon : step.icon}
            size={16}
            color={colour}
            strokeWidth={2.2}
          />
        )}
      </View>
      <Text style={[styles.stepLabel, { color: colour }]} numberOfLines={1}>
        {state === "running" ? step.running : step.label}
      </Text>
      {state === "failed" ? (
        <Text style={[styles.stepNote, { color: t.tertiaryLabel }]}>will retry</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: "center",
  },
  markWrap: { width: 100, height: 100, alignItems: "center", justifyContent: "center" },
  mark: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  textContainer: { marginTop: 20, height: 70, alignItems: "center" },
  title: { ...IOSAppFont.title2, textAlign: "center" },
  blurb: { ...IOSAppFont.subheadline, textAlign: "center", marginTop: 8 },
  metrics: { alignItems: "center", marginTop: 10 },
  percent: { fontFamily: "Poppins_700Bold", fontSize: 48, lineHeight: 54 },
  metricSub: { ...IOSAppFont.caption1, marginTop: -2 },
  track: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    marginTop: 20,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 3 },
  steps: { width: "100%", marginTop: 30, gap: 16 },
  step: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepLabel: { ...IOSAppFont.subheadline, flex: 1 },
  stepNote: { ...IOSAppFont.caption2 },
});
