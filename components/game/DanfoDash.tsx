// components/game/DanfoDash.tsx
//
// Danfo Dash — a three-lane dodger. Tap the left or right half of the road to
// change lane; hit a car, okada or cone and the run ends; drive through a fuel
// drop for a bonus.
//
// ── Why the loop lives in a ref ──────────────────────────────────────────────
// The simulation is plain mutable state advanced by requestAnimationFrame, and
// React is told to repaint with a frame counter. Putting obstacles in useState
// would allocate and diff a new array every frame for no gain — there are never
// more than a dozen items on the road, so one re-render per frame is cheap, but
// the state itself must not be.
//
// Fuel here is a score bonus only. It is NOT fuel coins: coins are money in
// this app (PRD §fuel coins), and paying them out from a client-side game would
// be a free-money exploit. Wiring rewards needs a server-validated session first.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  Bus01Icon,
  Car01Icon,
  Cone01Icon,
  Fuel01Icon,
  Motorbike01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

import { IOSAppFont, IOSButton } from "@/components/ios";
import { Colors } from "@/constants/colors";
import { haptics } from "@/src/utils/haptics";

// ─── Tuning ──────────────────────────────────────────────────────────────────

const LANES = 3;
const ITEM = 52;              // obstacle / pickup size, px
const PLAYER = 60;            // bus size, px
const PLAYER_BOTTOM = 120;    // bus distance from the bottom of the road
const START_SPEED = 280;      // px/s
const MAX_SPEED = 720;
const ACCEL = 9;              // px/s gained per second
const FUEL_BONUS = 5;         // points per fuel drop
const DASH = 60;              // lane marking period, px

type Kind = "car" | "okada" | "cone" | "fuel";
type Item = { id: number; lane: number; y: number; kind: Kind };
type Phase = "ready" | "playing" | "over";

type Sim = {
  lane: number;
  items: Item[];
  speed: number;
  dist: number;
  fuel: number;
  elapsed: number;
  spawnIn: number;
  nextId: number;
};

const ICON: Record<Kind, any> = {
  car: Car01Icon,
  okada: Motorbike01Icon,
  cone: Cone01Icon,
  fuel: Fuel01Icon,
};
const COLOR: Record<Kind, string> = {
  car: "#E5484D",
  okada: "#7C66DC",
  cone: "#F76B15",
  fuel: Colors.gold,
};

const freshSim = (): Sim => ({
  lane: 1,
  items: [],
  speed: START_SPEED,
  dist: 0,
  fuel: 0,
  elapsed: 0,
  spawnIn: 0.6,
  nextId: 0,
});

const scoreOf = (s: Sim) => Math.floor(s.dist / 50) + s.fuel * FUEL_BONUS;

/** Picks what to drop next without ever walling off all three lanes. */
function spawn(s: Sim) {
  const lane = Math.floor(Math.random() * LANES);
  // Obstacles still near the top, by lane. If two other lanes are already
  // blocked in that band, a third obstacle would leave no way through.
  const blocked = new Set(
    s.items.filter((i) => i.kind !== "fuel" && i.y < ITEM * 3).map((i) => i.lane),
  );
  blocked.delete(lane);
  const roll = Math.random();
  let kind: Kind = roll < 0.18 ? "fuel" : roll < 0.55 ? "car" : roll < 0.8 ? "okada" : "cone";
  if (kind !== "fuel" && blocked.size >= LANES - 1) kind = "fuel";
  s.items.push({ id: s.nextId++, lane, y: -ITEM, kind });
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface DanfoDashProps {
  visible: boolean;
  best: number;
  onClose: () => void;
  /** Called once per finished run with its score. */
  onRunEnd: (score: number) => void;
}

export function DanfoDash({ visible, best, onClose, onRunEnd }: DanfoDashProps) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [phase, setPhase] = useState<Phase>("ready");
  const [, setFrame] = useState(0);

  const sim = useRef<Sim>(freshSim());
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const laneW = size.w / LANES;
  const busX = useSharedValue(0);
  const busStyle = useAnimatedStyle(() => ({ transform: [{ translateX: busX.value }] }));

  const laneLeft = useCallback(
    (lane: number, w: number) => lane * (sizeRef.current.w / LANES) + (sizeRef.current.w / LANES - w) / 2,
    [],
  );

  const stopLoop = () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
    last.current = null;
  };

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const crash = useCallback(() => {
    stopLoop();
    haptics.error();
    setPhaseBoth("over");
    onRunEnd(scoreOf(sim.current));
  }, [onRunEnd]);

  const step = useCallback(
    (now: number) => {
      if (phaseRef.current !== "playing") return;
      // Cap dt so a dropped frame (or a debugger pause) teleports nothing
      // through the bus.
      const dt = last.current == null ? 0 : Math.min((now - last.current) / 1000, 0.05);
      last.current = now;

      const s = sim.current;
      const { h } = sizeRef.current;
      s.elapsed += dt;
      s.speed = Math.min(MAX_SPEED, s.speed + ACCEL * dt);
      s.dist += s.speed * dt;

      s.spawnIn -= dt;
      if (s.spawnIn <= 0) {
        spawn(s);
        // Gaps shrink as speed grows, so density rises with difficulty.
        s.spawnIn = Math.max(0.32, 0.85 - s.elapsed * 0.008) * (START_SPEED / s.speed) * 1.6;
      }

      const busTop = h - PLAYER_BOTTOM - PLAYER;
      const busBottom = h - PLAYER_BOTTOM;
      // A few px of forgiveness: a clip that close reads as a dodge.
      const slack = 8;

      const kept: Item[] = [];
      for (const it of s.items) {
        it.y += s.speed * dt;
        const hit =
          it.lane === s.lane && it.y + ITEM - slack > busTop && it.y + slack < busBottom;
        if (hit) {
          if (it.kind === "fuel") {
            s.fuel += 1;
            haptics.tap();
            continue;
          }
          crash();
          return;
        }
        if (it.y < h) kept.push(it);
      }
      s.items = kept;

      setFrame((f) => (f + 1) % 1_000_000);
      raf.current = requestAnimationFrame(step);
    },
    [crash],
  );

  const start = useCallback(() => {
    stopLoop();
    sim.current = freshSim();
    busX.value = laneLeft(1, PLAYER);
    setPhaseBoth("playing");
    haptics.press();
    raf.current = requestAnimationFrame(step);
  }, [busX, laneLeft, step]);

  const steer = (dir: -1 | 1) => {
    if (phaseRef.current !== "playing") return;
    const s = sim.current;
    const next = Math.max(0, Math.min(LANES - 1, s.lane + dir));
    if (next === s.lane) return;
    s.lane = next;
    haptics.select();
    busX.value = withTiming(laneLeft(next, PLAYER), { duration: 110 });
  };

  // Reset whenever the game is opened; tear down whenever it is closed.
  useEffect(() => {
    if (visible) {
      sim.current = freshSim();
      setPhaseBoth("ready");
    } else {
      stopLoop();
      phaseRef.current = "ready";
    }
    return stopLoop;
  }, [visible]);

  // Keep the bus centred in its lane when the road is measured or resized.
  useEffect(() => {
    if (size.w) busX.value = laneLeft(sim.current.lane, PLAYER);
  }, [size.w, busX, laneLeft]);

  // Backgrounding mid-run ends the run rather than pausing it: a pause would
  // need a resume UI, and coming back to a bus already moving is worse.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st !== "active" && phaseRef.current === "playing") crash();
    });
    return () => sub.remove();
  }, [crash]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  const s = sim.current;
  const score = scoreOf(s);
  const dashOffset = s.dist % DASH;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.root} onLayout={onLayout}>
        {/* Lane markings. Offset by distance so the road appears to move. */}
        {size.w > 0 &&
          Array.from({ length: LANES - 1 }, (_, i) => (
            <View key={i} style={[styles.divider, { left: laneW * (i + 1) - 2 }]} pointerEvents="none">
              {Array.from({ length: Math.ceil(size.h / DASH) + 2 }, (_, j) => (
                <View
                  key={j}
                  style={[styles.dash, { top: j * DASH - DASH + dashOffset }]}
                />
              ))}
            </View>
          ))}

        {s.items.map((it) => (
          <View
            key={it.id}
            pointerEvents="none"
            style={[
              styles.item,
              {
                left: laneLeft(it.lane, ITEM),
                transform: [{ translateY: it.y }],
                backgroundColor: COLOR[it.kind] + "33",
                borderColor: COLOR[it.kind],
              },
            ]}
          >
            <HugeiconsIcon icon={ICON[it.kind]} size={30} color={COLOR[it.kind]} strokeWidth={2} />
          </View>
        ))}

        <Animated.View
          pointerEvents="none"
          style={[styles.bus, { bottom: PLAYER_BOTTOM }, busStyle]}
        >
          <HugeiconsIcon icon={Bus01Icon} size={38} color="#1A1A1A" strokeWidth={2} />
        </Animated.View>

        {/* Controls: each half of the road steers toward its side. */}
        <View style={StyleSheet.absoluteFill} pointerEvents={phase === "playing" ? "auto" : "none"}>
          <View style={styles.controls}>
            <Pressable style={styles.half} onPressIn={() => steer(-1)} accessibilityLabel="Move left" />
            <Pressable style={styles.half} onPressIn={() => steer(1)} accessibilityLabel="Move right" />
          </View>
        </View>

        {/* HUD */}
        <View style={[styles.hud, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityLabel="Close game">
            <HugeiconsIcon icon={Cancel01Icon} size={22} color="#fff" />
          </Pressable>
          <View style={styles.hudRight}>
            <View style={styles.pill}>
              <HugeiconsIcon icon={Fuel01Icon} size={16} color={Colors.gold} />
              <Text style={[IOSAppFont.label, styles.hudText]}>{s.fuel}</Text>
            </View>
            <View style={styles.pill}>
              <Text style={[IOSAppFont.label, styles.hudText]}>{score}</Text>
            </View>
          </View>
        </View>

        {phase !== "playing" && (
          <View style={styles.overlay}>
            <View style={styles.card}>
              <Text style={[IOSAppFont.screenTitle, styles.cardTitle]}>
                {phase === "over" ? "Crashed!" : "Danfo Dash"}
              </Text>
              {phase === "over" ? (
                <>
                  <Text style={[styles.bigScore, { color: Colors.gold }]}>{score}</Text>
                  <Text style={[IOSAppFont.description, styles.cardSub]}>
                    {score > best ? "New best!" : `Best: ${best}`} · {s.fuel} fuel picked up
                  </Text>
                </>
              ) : (
                <Text style={[IOSAppFont.description, styles.cardSub]}>
                  Tap left or right to change lane. Dodge cars, okadas and cones. Grab fuel for +{FUEL_BONUS}.
                </Text>
              )}
              <IOSButton
                title={phase === "over" ? "Play again" : "Start"}
                onPress={start}
                fullWidth
                noHaptics
                style={{ marginTop: 18 }}
              />
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#2B2D31", overflow: "hidden" },
  divider: { position: "absolute", top: 0, bottom: 0, width: 4 },
  dash: { position: "absolute", width: 4, height: DASH / 2, borderRadius: 2, backgroundColor: "#ffffff55" },
  item: {
    position: "absolute",
    top: 0,
    width: ITEM,
    height: ITEM,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  bus: {
    position: "absolute",
    left: 0,
    width: PLAYER,
    height: PLAYER,
    borderRadius: 16,
    backgroundColor: "#FFD60A", // danfo yellow
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  controls: { flex: 1, flexDirection: "row" },
  half: { flex: 1 },
  hud: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hudRight: { flexDirection: "row", gap: 8 },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#00000066",
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#00000066",
  },
  hudText: { color: "#fff", fontVariant: ["tabular-nums"] },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#00000088",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    padding: 24,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
  },
  cardTitle: { color: "#fff" },
  cardSub: { color: "#ffffffaa", textAlign: "center", marginTop: 8 },
  bigScore: { fontFamily: "Poppins_700Bold", fontSize: 56, marginTop: 8 },
});

export default DanfoDash;
