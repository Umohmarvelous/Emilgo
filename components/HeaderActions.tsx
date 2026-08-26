// components/HeaderActions.tsx
//
// The pair of controls that sits at the top-right of a screen: a notification
// bell, and an overflow menu.
//
// ── Why this is one component and not two buttons per screen ────────────────
// Before this existed, each screen drew its own bell and its own avatar button,
// which meant each screen decided independently whether the bell was badged,
// what the badge counted, and what tapping it did. The Home header had a bell
// that was decoration — it wasn't a button at all. One component means the
// badge is the same number everywhere, and a screen that wants these controls
// gets the working version rather than a copy of whichever one it was pasted
// from.
//
// ── The two controls ────────────────────────────────────────────────────────
//   Bell  — routes to the notifications screen and carries the unread badge.
//   Menu  — an iOS popover. Search is always its first item, because search is
//           the action most screens want here and giving it a third permanent
//           button would crowd a header that also has to hold a title.
//
// Screens add their own items through `extraMenu`; they appear below the
// standard ones, separated.
//
// ── Glass ───────────────────────────────────────────────────────────────────
// Both controls are glass circles, never coloured blocks. Nothing here animates
// opacity: press feedback is scale only, because these sit on glass and
// animating alpha on or above a GlassView renders the effect wrong
// (expo/expo#41024).

import React from "react";
import { View, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  MoreHorizontalCircle01Icon,
  Notification03Icon,
} from "@hugeicons/core-free-icons";
import { Glass, IOSMenu, IOSBadge, useIOSTheme, type IOSMenuItem } from "@/components/ios";
import { useUnreadNotificationCount } from "@/src/store/useNotificationsStore";
import Avatar from "@/components/Avatar";
import { useAuthStore } from "@/src/store/useStore";
import { AccountMenu } from "./AccountMenu";
import { SymbolView } from "expo-symbols";
import { Colors } from "@/constants/colors";


const SIZE = 38;

export interface HeaderActionsProps {
  /**
   * Where the bell goes. Defaults to the notifications route; the main tab
   * shell passes its own handler because there the bell switches tab rather
   * than pushing a screen.
   */
  onBellPress?: () => void;
  /** Opens the screen's own search. Omit to hide the Search item entirely. */
  onSearchPress?: () => void;
  /** Screen-specific items, appended below the standard ones. */
  extraMenu?: IOSMenuItem[];
  /** Replaces the default menu contents entirely. */
  menu?: IOSMenuItem[];
  /** Icon and glyph colour. Defaults to the theme's primary label. */
  tint?: string;
  style?: StyleProp<ViewStyle>;
}

function Circle({
  children,
  onPress,
  label,
  fallbackTint,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  label: string;
  fallbackTint: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
    >
      <Glass
        variant="regular"
        interactive
        radius={SIZE / 2}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        fallbackIntensity={40}
        fallbackTint={fallbackTint}
      />
      {children}
    </Pressable>
  );
}

export default function HeaderActions({
  onBellPress,
  onSearchPress,
  extraMenu,
  menu,
  tint,
  style,
}: HeaderActionsProps) {
  const t = useIOSTheme();
  const router = useRouter();
  const unread = useUnreadNotificationCount();

  
  const color = tint ?? t.label;
  const fallbackTint = t.scheme === "dark" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.05)";

  const user = useAuthStore((s) => s.user);


  const items: IOSMenuItem[] = React.useMemo(() => {
    if (menu) return menu;

    const standard: IOSMenuItem[] = [];
    if (onSearchPress) {
      standard.push({ label: "Search", symbol: "magnifyingglass", onPress: onSearchPress });
    }
    standard.push(
      {
        label: "Notifications",
        symbol: "bell",
        onPress: () => (onBellPress ? onBellPress() : router.push("/(main)/notifications" as any)),
      },
      { label: "Bookmarks", symbol: "bookmark", onPress: () => router.push("/bookmarks" as any) },
      { label: "Settings", symbol: "gearshape", onPress: () => router.push("/(main)/settings" as any) },
    );

    if (extraMenu?.length) {
      // The first screen-specific item starts a new group, so the standard
      // items stay recognisably standard wherever this appears.
      standard.push({ ...extraMenu[0], startsNewSection: true }, ...extraMenu.slice(1));
    }
    return standard;
  }, [menu, extraMenu, onSearchPress, onBellPress, router]);

  return (
    <View style={[styles.row, style]}>
      {/* The badge is a sibling of the circle, not a child: the circle clips to
          its radius so the glass corners stay clean, and a badge inside it
          would be clipped along with them. */}

      {/* <View>
        <Circle
          label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          fallbackTint={fallbackTint}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (onBellPress) onBellPress();
            else router.push("/(main)/notifications" as any);
          }}
        >
          <HugeiconsIcon icon={Notification03Icon} size={21} color={color} strokeWidth={2} />
        </Circle>
        <IOSBadge count={unread} borderColor={t.systemBackground} />
      </View> */}



      <View>
        {/* Avatar → the account menu: other signed-in accounts, add an account, appearance, support, sign out. */}
        <AccountMenu
          anchor={
            <View style={{ backgroundColor: Colors.overlay, borderRadius: 50, alignItems: 'center', justifyContent: 'center' }}>
              {/* <Glass
                variant="regular"
                interactive
                radius={30}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
                fallbackIntensity={40}
                fallbackTint={color}
              /> */}
              {user?.profile_photo ? (
                <Avatar name={user?.full_name || "U"} photoUri={user.profile_photo} size={36} />
              ) : (
                <View style={{margin: 7}}>
                  <SymbolView name="person.fill" size={24} tintColor={color} fallback={color} />
                </View>
              )}
            </View>
          }
        />
      </View>

      {/* <IOSMenu
        items={items}
        anchor={
          <Circle label="More" fallbackTint={fallbackTint}>
            <HugeiconsIcon
              icon={MoreHorizontalCircle01Icon}
              size={21}
              color={color}
              strokeWidth={2}
            />
          </Circle>
        }
      /> */}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  pressed: { transform: [{ scale: 0.92 }] },
});
