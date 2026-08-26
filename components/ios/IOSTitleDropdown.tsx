// components/ios/IOSTitleDropdown.tsx
//
// The Instagram feed switcher: the current lane's name IS the title, with a
// chevron beside it, and tapping it drops a short menu of the other lanes.
//
// ── Why this instead of a segmented control ─────────────────────────────────
// A capsule segmented control is the right shape when the options are peers you
// flick between and each is one word — Profile / Settings / Activity. A feed's
// lanes are not that: they are *modes*, you stay in one for a long session, and
// the control was spending a full row of a scarce header on two words that
// rarely change. Instagram, Threads and X all landed on the same answer — put
// the current lane in the title and hide the rest behind a tap.
//
// ── Why not IOSMenu ────────────────────────────────────────────────────────
// IOSMenu is an anchored context menu for ACTIONS: each row does something and
// the menu has no notion of a current value. This is a value picker — exactly
// one row is selected, that row shows a tick, and the label it puts in the
// title has to stay in sync. Different job, different component.

import React from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  Dimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

import { Glass } from "./Glass";
import { useIOSTheme } from "./theme";
import { IOSAppFont } from "./theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");


export interface IOSTitleDropdownOption<K extends string = string> {
  key: K;
  label: string;
  /** Second line in the menu row — what this lane actually shows. */
  detail?: string;
  /** SF Symbol drawn at the leading edge of the row. */
  symbol?: SymbolViewProps["name"];
}

export interface IOSTitleDropdownProps<K extends string = string> {
  options: IOSTitleDropdownOption<K>[];
  active: K;
  onChange: (key: K) => void;
  /** Small text above the title, e.g. the app name. */
  overline?: string;
  style?: StyleProp<ViewStyle>;
  /** Menu width. Defaults to a comfortable reading measure. */
  menuWidth?: number;
}

const SPRING = { damping: 22, stiffness: 260, mass: 0.7 } as const;

export function IOSTitleDropdown<K extends string = string>({
  options,
  active,
  onChange,
  overline,
  style,
  menuWidth = 268,
}: IOSTitleDropdownProps<K>) {
  const t = useIOSTheme();
  const [open, setOpen] = React.useState(false);
  // Where the trigger sits on screen, so the menu can hang from it rather than
  // appearing in the middle of nowhere.
  const [anchor, setAnchor] = React.useState({ x: 16, y: 100 });
  const triggerRef = React.useRef<View>(null);

  const progress = useSharedValue(0);

  const present = React.useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, _w, h) => {
      setAnchor({ x, y: y + h + 8 });
      setOpen(true);
      progress.value = withSpring(1, SPRING);
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [progress]);

  const dismiss = React.useCallback(() => {
    progress.value = withTiming(0, { duration: 140 });
    // Unmount after the exit finishes, or the menu vanishes on the first frame.
    setTimeout(() => setOpen(false), 140);
  }, [progress]);

  const current = options.find((o) => o.key === active) ?? options[0];

  // Transform only. The menu is glass, and animating opacity on a GlassView or
  // any ancestor renders the effect incorrectly (expo/expo#41024) — so it grows
  // from its top-left corner instead of fading.
  const menuStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-8, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.94, 1]) },
    ],
  }));

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg` }],
  }));

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={present}
        style={[styles.trigger, style]}
        accessibilityRole="button"
        accessibilityLabel={`${current?.label}. Change feed`}
        accessibilityHint="Opens the list of feeds"
        hitSlop={8}
      >
        <View>
          {!overline ? (
            <Text style={[styles.overline, { color: t.tertiaryLabel }]}>{overline}</Text>
          ) : null}
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: t.label }]} numberOfLines={1}>
              {current?.label}
            </Text>
            <Animated.View style={chevronStyle}>
              <SymbolView
                name="chevron.down"
                size={13}
                tintColor={t.label}
                resizeMode="scaleAspectFit"
                fallback={<Text style={{ color: t.label, fontSize: 11 }}>▾</Text>}
              />
            </Animated.View>
          </View>
        </View>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="none"
        onRequestClose={dismiss}
        statusBarTranslucent
      >
        {/* Tapping anywhere outside closes, which is what every dropdown on
            both platforms does and what a user will try first. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close menu">
          <View style={StyleSheet.absoluteFill} />
        </Pressable>

        <Animated.View
          style={[
            styles.menuShadow,
            // { top: anchor.y, left: anchor.x-100, width: menuWidth },
            { alignSelf:'center', top: anchor.y, width: menuWidth },
            menuStyle,
            , {borderWidth: .5, borderColor: t.opaqueSeparator}]}
        >
          <Glass
            variant="regular"
            radius={30}
            style={styles.menu}
            fallbackIntensity={20}
            // fallbackTint={t.secondarySystemBackground}
          >
            {options.map((o, i) => {
              const on = o.key === active;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    // Change first, then dismiss: swapping the lane while the
                    // menu is still on screen makes the tick visibly move, so
                    // the choice is confirmed before anything disappears.
                    if (!on) onChange(o.key);
                    dismiss();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.separator },
                    pressed && { backgroundColor: t.tertiarySystemFill },
                  ]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                >
                  {/* {o.symbol ? (
                    <SymbolView
                      name={o.symbol}
                      size={19}
                      tintColor={on ? t.tint : t.secondaryLabel}
                      resizeMode="scaleAspectFit"
                      fallback={<View style={{ width: 19, height: 19 }} />}
                    />
                  ) : null} */}

                  <View style={styles.rowText}>
                    <Text
                      style={[
                        styles.rowLabel,
                        { color: on ? t.tint : t.label },
                        on && { fontFamily: "Poppins_600SemiBold" },
                      ]}
                    >
                      {o.label}
                    </Text>
                    {o.detail ? (
                      <Text style={[styles.rowDetail, { color: t.tertiaryLabel }]} numberOfLines={1}>
                        {o.detail}
                      </Text>
                    ) : null}
                  </View>

                  {on ? (
                    <SymbolView
                      name="checkmark"
                      size={15}
                      tintColor={t.tint}
                      resizeMode="scaleAspectFit"
                      fallback={<Text style={{ color: t.tint }}>✓</Text>}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </Glass>
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { alignSelf: "center", paddingVertical: 12 },
  overline: { ...IOSAppFont.caption2, letterSpacing: 0.4, textTransform: "uppercase" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { ...IOSAppFont.label, fontFamily: "Poppins_700Bold" },

  // Glass clips, so the shadow lives on a wrapper outside it.
  menuShadow: {
    position: "relative",
    borderRadius: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  menu: { borderRadius: 30, overflow: "hidden" },

  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 35, paddingVertical: 18 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { ...IOSAppFont.body },
  rowDetail: { ...IOSAppFont.caption1, marginTop: 1 },
});

export default IOSTitleDropdown;
