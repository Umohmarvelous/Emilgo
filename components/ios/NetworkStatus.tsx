// components/ios/NetworkStatus.tsx
//
// Connection state as a small piece of header chrome, not a banner.
//
// The old NetworkBanner took a full-width strip across the top of the app,
// which pushed every screen's content down the moment the signal dipped — a
// layout shift as punishment for bad reception. This sits in the header's
// centre slot instead, in the space the logo normally occupies, and swaps
// places with it.
//
//   offline / weak → red    "connection is weak"   + slashed-wifi glyph
//   reconnecting   → green  "connecting…"          + wifi glyph, pulsing
//   healthy        → nothing; the logo comes back
//
// ── What counts as "weak" ────────────────────────────────────────────────────
// NetInfo gives `isConnected` (is there an interface) and `isInternetReachable`
// (did a probe actually get out). They disagree constantly on Nigerian mobile
// data: the radio is attached, the probe times out. That disagreement IS the
// weak-signal case, so it's treated as its own state rather than folded into
// offline.
//
// Transitions are debounced. A connection that flaps every few seconds would
// otherwise strobe the header, which is worse than showing nothing.

import React from "react";
import { View, Text, StyleSheet, type ViewStyle, type StyleProp, ActivityIndicator } from "react-native";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
// import { SymbolView } from "expo-symbols";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from "react-native-reanimated";

import { useIOSTheme, IOSAppFont } from "./theme";



export type ConnectionQuality = "healthy" | "weak" | "reconnecting";

/** How long a state must hold before it's shown. Stops a flapping link strobing. */
const SETTLE_MS = 900;
/** Grace period after recovery before the logo returns. */
const RECOVERY_MS = 1200;

function classify(state: NetInfoState): ConnectionQuality {
  // No interface at all — nothing to reconnect with yet.
  if (state.isConnected === false) return "weak";
  // Attached but nothing gets out. This is the common Nigerian-data failure.
  if (state.isInternetReachable === false) return "weak";
  // Probe hasn't come back yet.
  if (state.isInternetReachable === null) return "reconnecting";
  return "healthy";
}

/**
 * Live connection quality, debounced.
 *
 * Exported separately from the view so screens can react to it without
 * rendering the indicator — the sync layer's retry logic wants the same signal.
 */
export function useConnectionQuality(): ConnectionQuality {
  const [quality, setQuality] = React.useState<ConnectionQuality>("healthy");
  const pending = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = React.useRef<ConnectionQuality>("healthy");

  React.useEffect(() => {
    const commit = (next: ConnectionQuality) => {
      if (next === current.current) return;
      current.current = next;
      setQuality(next);
    };

    const unsubscribe = NetInfo.addEventListener((state) => {
      const next = classify(state);
      if (pending.current) clearTimeout(pending.current);

      // Degrading is worth showing promptly; recovering waits a little longer
      // so a link that drops straight back out doesn't flash "all clear".
      const delay = next === "healthy" ? RECOVERY_MS : SETTLE_MS;
      pending.current = setTimeout(() => commit(next), delay);
    });

    return () => {
      unsubscribe();
      if (pending.current) clearTimeout(pending.current);
    };
  }, []);

  return quality;
}

export interface NetworkStatusProps {
  /**
   * Shown when the connection is healthy — normally the app logo. The
   * indicator takes its place rather than displacing it, so the header's
   * centre slot never changes size.
   */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function NetworkStatus({ children, style }: NetworkStatusProps) {
  const theme = useIOSTheme();
  const quality = useConnectionQuality();
  const pulse = useSharedValue(1);

  React.useEffect(() => {
    if (quality === "reconnecting") {
      pulse.value = withRepeat(
        withSequence(
          withTiming(0.4, { duration: 600, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [quality, pulse]);

  // Opacity is safe here: this is plain content sitting on the header's glass,
  // not the glass itself.
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (quality === "healthy") {
    return <View style={[styles.slot, style]}>{children}</View>;
  }

  const weak = quality === "weak";
  // const tint = weak ? theme.systemRed : theme.tint;

  return (
    <Animated.View
      style={[styles.slot, styles.row, pulseStyle, style]}
      accessibilityRole="alert"
      accessibilityLabel={weak ? "Offline" : "Reconnecting"}
      accessibilityLiveRegion="polite"
    >
      {/* <SymbolView
        name={weak ? "w.circle" : "wifi"}
        size={13}
        tintColor={tint}
        fallback={<View style={[styles.dot, { backgroundColor: tint }]} />}
      /> */}
      <View style={[styles.row]}>
        {weak ? (
          <View style={{alignItems: 'center', justifyContent: 'center', gap: 15, flexDirection: 'row', }}>
            <ActivityIndicator color={theme.label} />
            
            {/* <HugeiconsIcon icon={CellularNetworkOfflineIcon} size={17} color={'red'}/> */}

            <Text numberOfLines={1} style={[IOSAppFont.label, styles.label, { color: theme.label, fontFamily: "Poppins_500Bold" }, {}]}>{`No internet...`}</Text>
          </View>
        ) : (
          <View style={{alignItems: 'center', justifyContent: 'center', gap: 12, flexDirection: 'row'}}>
              <ActivityIndicator color={theme.label}  />
              <Text numberOfLines={1} style={[IOSAppFont.label, styles.label, { color: theme.label, fontFamily: "Poppins_500Bold" }]}>Reconnecting...</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { alignItems: "center", justifyContent: "center", minHeight: 26 },
  row: { flexDirection: "row", gap: 5 },
  label: { marginTop: 0 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});

export default NetworkStatus;
