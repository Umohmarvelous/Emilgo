// app/(main)/profile.tsx
//
// The Profile tab: one screen, three panes, one pinned bar.
//
//   Profile  — the role dashboard, earnings, credit tier, partner CTA
//   Account Settings — every settings section, plus the editable identity fields
//   Activity — achievements and unified history
//
// ── Why the panes live in this file ──────────────────────────────────────────
// They share too much to be separate screens: the same user, the same copy
// toast, the same edit sheet, the same refresh. Splitting them would mean
// duplicating that plumbing three ways or hoisting it into a context that only
// ever has one consumer. `SwipeableTabs` mounts only the active pane, so the
// cost of keeping them together is a `tab === …` check, not a render.
//
// ── The bar ──────────────────────────────────────────────────────────────────
// The identity header scrolls away, but the actions on it (search, QR, sign
// out) must not — those are the reasons people open this screen. So they live
// in a bar pinned above everything, which materialises its glass once the hero
// has gone. The centre slot is `NetworkStatus`, the same as every other screen:
// it shows the collapsed name when the connection is fine and takes the slot
// over when it isn't.
//
// ── Search ───────────────────────────────────────────────────────────────────
// The resting search bar is a BUTTON, not a field — see the note in
// IOSSearchBar. It opens a full-screen overlay whose index covers all three
// panes at once (`src/data/profileSearchIndex.ts`), so "phone", "dark mode" and
// a trip to Aba are all reachable from the same query.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
// import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  UserIcon,
  Mail01Icon,
  CallIcon,
  CarIcon,
  BuildingIcon,
  LocationIcon,
  AddCircleIcon,
  Close,
  Camera01Icon,
  CheckmarkBadge01Icon,
  Trophy,
  Wallet,
  Star,
  ChevronDown,
  ChevronRight,
  Copy01Icon,
  Car01Icon,
  PencilLine,
  Tick02FreeIcons,
  Hospital,
  Search02Icon,
  Logout02Icon,
  Copy02Icon,
} from "@hugeicons/core-free-icons";

import { useAuthStore } from "@/src/store/useStore";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { supabase } from "@/src/services/supabase";
import { Colors } from "@/constants/colors";
import Avatar from "@/components/Avatar";
import { TripsStorage } from "@/src/services/storage";
import { haptics } from "@/src/utils/haptics";
import type { EmergencyContact, Trip } from "@/src/models/types";
import PassengerDashboard from "../(passenger)";
import DriverDashboard from "../(driver)";
import QuickReceiveModal from "@/components/quickrecieveModal";
import StatPill from "@/components/StatPill";
import { formatNaira } from "@/src/utils/helpers";
import { pickFromLibrary, uploadAvatar } from "@/src/services/avatar";
// import { formatCs } from "@/src/services/coins";
import BalanceCard from "@/components/BalanceCard";
import FindDriverModal from "@/components/FindDriverModal";
import { getBiometricCredentials } from "@/src/services/auth";
import CreditMeter from "@/components/CreditMeter";
import AchievementsCard from "@/components/AchievementsCard";
import { useCreditsStore } from "@/src/store/useCreditsStore";
import { useProgramStore } from "@/src/store/useProgramStore";
import { useTransactionsStore } from "@/src/store/useTransactionsStore";
import { useAchievementsStore } from "@/src/store/useAchievementsStore";
import { useFollowsStore } from "@/src/store/useFollowsStore";
import { useActivityFeed } from "@/src/hooks/useActivityFeed";
import ActivityFeed from "@/components/ActivityFeed";
import {
  Glass,
  iosAlert,
  IOSSearchOverlay,
  IOSListSection,
  IOSListRow,
  SwipeableTabs,
  NetworkStatus,
  useIOSTheme,
  useTabBarInset,
  IOSAppFont,
  type IOSSegment,
  type IOSFilterChip,
  type IOSSearchResult,
} from "@/components/ios";
import { SETTINGS_SECTIONS } from "@/src/data/settingsIndex";
import {
  buildProfileIndex,
  searchProfileIndex,
  countByCategory,
  type ProfilePane,
  type ProfileSearchCategory,
  type ProfileSearchItem,
} from "@/src/data/profileSearchIndex";
import { triggerSyncNow } from "@/src/services/sync";
// import { SymbolView } from "expo-symbols";

// Slide-in "Copied" toast, shared via context so every copy action triggers it.
const CopyToastContext = React.createContext<() => void>(() => {});

function CopyToast({ nonce }: { nonce: number }) {
  const insets = useSafeAreaInsets();
  const ty = useSharedValue(-160);
  const op = useSharedValue(0);

  useEffect(() => {
    if (nonce === 0) return;
    ty.value = withSpring(0, { damping: 18, stiffness: 220 });
    op.value = withTiming(1, { duration: 150 });
    const t = setTimeout(() => {
      ty.value = withTiming(-160, { duration: 260 });
      op.value = withTiming(0, { duration: 260 });
    }, 1400);
    return () => clearTimeout(t);
  }, [nonce, ty, op]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
    opacity: op.value,
  }));

  return (
    <Animated.View pointerEvents="none" style={[toastStyles.wrap, { top: insets.top + 0 }, aStyle]}>
      <View style={toastStyles.pill}>
        <HugeiconsIcon icon={CheckmarkBadge01Icon as any} size={18} color="#fff" />
        <Text style={toastStyles.text}>Copied successfully</Text>
      </View>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  text: { fontFamily: "Poppins_600SemiBold", fontSize: 13, color: "#fff" },
});

// ─── Glass card ──────────────────────────────────────────────────────────────
//
// Glass clips, so it can't cast a shadow. The shadow therefore lives on a
// wrapper OUTSIDE the clipped surface — the card is two views, not one.

function GlassCard({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: object;
  padded?: boolean;
  }) {


  return (
    <View style={[styles.cardShadow, style, ]}>
      <View style={styles.cardClip}>

        <View style={padded ? styles.cardInner : undefined}>{children}</View>
      </View>
    </View>
  );
}

/** Round glass action button used in the pinned bar. */
// function BarButton({
//   icon,
//   label,
//   onPress,
//   color,
// }: {
//   icon: any;
//   label: string;
//   onPress: () => void;
//   color: string;
// }) {
//   const ios = useIOSTheme();
//   return (
//     <Pressable
//       onPress={onPress}
//       hitSlop={8}
//       style={styles.barBtn}
//       accessibilityRole="button"
//       accessibilityLabel={label}
//     >
//       <Glass
//         variant="regular"
//         interactive
//         radius={22}
//         style={StyleSheet.absoluteFill}
//         pointerEvents="none"
//         fallbackIntensity={40}
//         fallbackTint={ios.tertiarySystemFill}
//       />
//       <HugeiconsIcon icon={icon} size={19} color={color} />
//     </Pressable>
//   );
// }

/**
 * Fades its children with the header's collapse.
 *
 * Safe because it carries no glass — only the avatar and the name. Anything
 * with a `Glass` inside must never sit under an animated opacity
 * (expo/expo#41024); the bar's own material uses `present` instead.
 */
function BarFade({
  visible,
  children,
  style,
}: {
  visible: boolean;
  children: React.ReactNode;
  style?: object;
}) {
  const o = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    o.value = withTiming(visible ? 1 : 0, { duration: 220 });
  }, [visible, o]);

  const aStyle = useAnimatedStyle(() => ({ opacity: o.value }));

  return (
    <Animated.View pointerEvents={visible ? "auto" : "none"} style={[style, aStyle]}>
      {children}
    </Animated.View>
  );
}

/**
 * The profile picture, travelling.
 *
 * It lives OUTSIDE the scroll view, because a view inside the scroll can only
 * scroll away — it can't stop at the bar. So the hero reserves an empty slot of
 * exactly its size and this overlay draws it, tracking the scroll one-to-one
 * until it reaches the bar, then docking there.
 *
 *     translateY = heroTop − progress × travel     (progress = scrollY / travel)
 *
 * ── Why the extra shift ──────────────────────────────────────────────────────
 * `scale` works about the view's CENTRE, so shrinking alone would pull the top
 * and left edges inward and the avatar would drift diagonally as it shrank. The
 * shift term puts those edges back where they started, which is what makes the
 * motion read as "the same picture getting smaller" rather than "a picture
 * sliding and resizing at once".
 *
 * Transforms compose right-to-left, so `scale` is applied first and the
 * translations act on the already-scaled result — that ordering is load-bearing.
 */
function TravellingAvatar({
  scrollY,
  insetTop,
  barHeight,
  name,
  photoUri,
  onPress,
  badgeBg,
  badgeColor,
}: {
  scrollY: SharedValue<number>;
  insetTop: number;
  barHeight: number;
  name: string;
  photoUri?: string | null;
  onPress: () => void;
  badgeBg: string;
  badgeColor: string;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const heroTop = barHeight + HERO_PAD_TOP;
  const dockedTop = insetTop + (BAR_ROW_HEIGHT - AVATAR_BOX * AVATAR_SCALE) / 2;
  // Guard the divide: a zero travel would make progress NaN on the first frame.
  const travel = Math.max(1, heroTop - dockedTop);

  const avatarStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, Math.max(0, scrollY.value / travel));
    const scale = 1 - (1 - AVATAR_SCALE) * progress;
    // Scale happens from the center of the view. To keep the left edge pinned if it was
    // on the left, we would shift by `(AVATAR_BOX / 2) * (1 - scale)`.
    // But it starts in the center of the screen, and we want it to end up at `left: HERO_INSET`.
    const startX = 0; // because it is alignSelf: 'center'
    // End X in the local coordinate system of the center:
    const centerLeftEdge = (screenWidth - AVATAR_BOX) / 2; 
    // We want the view's left edge to be at HERO_INSET.
    // That means moving it left by (centerLeftEdge - HERO_INSET).
    // Plus, the scale shift so the left edge is what hits HERO_INSET.
    const shiftScale = (AVATAR_BOX / 2) * (1 - scale);
    const shiftXToLeft = -(centerLeftEdge - HERO_INSET); 
    
    // total X translation: start at 0, go to shiftXToLeft - shiftScale
    const tx = progress * shiftXToLeft - shiftScale;

    return {
      transform: [
        { translateY: heroTop - progress * travel - (AVATAR_BOX / 2) * (1 - scale) },
        { translateX: tx },
        { scale },
      ],
    };
  });

  // The camera badge is plain content — no glass — so it can safely fade.
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.max(0, scrollY.value / travel)),
  }));

  return (
    <Animated.View style={[styles.avatarTravel, avatarStyle]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Change photo">
        <View style={styles.avatarWrap}>
          <Avatar name={name} photoUri={photoUri} size={AVATAR} />
        </View>
        <Animated.View style={[styles.cameraBtn, { backgroundColor: badgeBg }, badgeStyle]}>
          <HugeiconsIcon icon={Camera01Icon} size={13} color={badgeColor} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

// Reusable InfoRow with Hugeicons
function InfoRow({
  icon,
  label,
  value,
  editable,
  onEdit,
  textColor,
  subTextColor,
  borderColor,
}: {
  icon: any;
  label: string;
  value: string;
  editable?: boolean;
  onEdit?: () => void;
  textColor: string;
  subTextColor: string;
  borderColor: string;
}) {
  const showCopied = React.useContext(CopyToastContext);
  const handleCopy = async () => {
    if (value) {
      await Clipboard.setStringAsync(value);
      haptics.success();
      showCopied();
    }
  };

  return (
    <View style={[infoStyles.row, { borderBottomColor: borderColor }]}>
      <View style={[infoStyles.iconBox]}>
        <HugeiconsIcon icon={icon} size={20} color={textColor} />
      </View>
      <View style={infoStyles.textBlock}>
        <Text style={[infoStyles.label, { color: textColor }]}>{label}</Text>
        <Text style={[infoStyles.value, { color: subTextColor }]} numberOfLines={1}>
          {value || "- -"}
        </Text>
      </View>
      {editable && (
        <View style={{ flexDirection: "row", gap: 20, alignItems: "center" }}>
          <Pressable onPress={handleCopy} hitSlop={12}>
            <HugeiconsIcon icon={Copy01Icon as any} size={20} color={Colors.primary} />
          </Pressable>
          <Pressable onPress={onEdit} hitSlop={12}>
            <HugeiconsIcon icon={PencilLine as any} fill={Colors.primary} size={20} color={Colors.primary} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 14,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  textBlock: { flex: 1 },
  label: {
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    fontFamily: "Poppins_500Medium",
    fontSize: 14,
    marginTop: 1,
  },
});

/** The three panes. Order is the swipe order. */
const PROFILE_TABS: IOSSegment<ProfilePane>[] = [
  { key: "profile", label: "Profile" },
  { key: "settings", label: "Settings" },
  { key: "activity", label: "Activity" },
];

const RECENTS_KEY = "emilgo.profile.recentSearches";
const MAX_RECENTS = 6;
const CARD_RADIUS = 30;
/** Height of the pinned bar, excluding the status bar. */
const BAR_ROW_HEIGHT = 52;

// ─── Header geometry ─────────────────────────────────────────────────────────
//
// The avatar travels from the hero into the bar, so both ends of that journey
// have to be known numbers rather than measured ones — a measured start would
// arrive a frame late and the avatar would jump on first scroll.
//
// The hero pins them down: `heroRow` aligns to `flex-start`, so the avatar's top
// edge IS the hero's content top, and its left edge IS the page gutter. The bar
// end is arithmetic from the row height. Nothing needs measuring.

/** Page gutter — the same on the hero and inside the bar, so X never travels. */
const HERO_INSET = 16;
const HERO_PAD_TOP = 10;
const AVATAR = 86;
/** Ring: 2pt border + 2pt padding, each side. */
const AVATAR_BOX = AVATAR + 8;
/** Size the avatar shrinks to once docked in the bar. */
const AVATAR_DOCKED = 30;
const AVATAR_SCALE = AVATAR_DOCKED / AVATAR;

const SEARCH_SUGGESTIONS = [
  "Dark mode",
  "Payout account",
  "Phone",
  "Free rides",
  "Achievements",
  "Sign out",
];

export default function ProfileTab() {
  const insets = useSafeAreaInsets();
  const ios = useIOSTheme();
  const { user, updateUser } = useAuthStore();
  const { theme } = useSettingsStore();
  const bottomInset = useTabBarInset();

  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [parkExpanded, setParkExpanded] = useState(false);
  const [showPersonalInfo, setShowPersonalInfo] = useState(true);
  const [showDriverDetails, setShowDriverDetails] = useState(true);

  const [totalEarnedCoins, setTotalEarnedCoins] = useState(0);
  const [finderVisible, setFinderVisible] = useState(false);
  const [copyNonce, setCopyNonce] = useState(0);
  const showCopied = useCallback(() => setCopyNonce((n) => n + 1), []);

  const isDark = theme === "dark";
  const bg = isDark ? Colors.background : Colors.textWhite;
  const textColor = isDark ? Colors.textWhite : Colors.text;
  const subTextColor = isDark ? Colors.textSecondary : Colors.textTertiary;
  const cardBg = isDark ? "rgba(255,255,255,0.06)" : Colors.border;
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";
  const modalBg = isDark ? Colors.text : Colors.textWhite;

  const [receiveVisible, setReceiveVisible] = useState(false);
  const [recentTrips, setRecentTrips] = useState<Trip[]>([]);

  const [tab, setTab] = useState<ProfilePane>("profile");
  const [refreshing, setRefreshing] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  // Shared with SwipeableTabs so the travelling avatar and the bar's collapse
  // are driven by the same offset and can never disagree by a frame.
  const scrollY = useSharedValue(0);

  const [knownEmail, setKnownEmail] = useState<string | null>(null);

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileQuery, setProfileQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<ProfileSearchCategory | "all">("all");
  const [recents, setRecents] = useState<string[]>([]);

  // ── Step 7: credit meter + achievements ──────────────────────────────────
  const credits = useCreditsStore((s) => s.balance);
  const creditHistory = useCreditsStore((s) => s.history);
  const programStatus = useProgramStore((s) => s.programStatus);
  const hydrateProgram = useProgramStore((s) => s.hydrateFromUser);
  const txHistory = useTransactionsStore((s) => s.history);
  const evaluateAchievements = useAchievementsStore((s) => s.evaluate);
  const unlockedAchievements = useAchievementsStore((s) => s.unlocked);
  const activities = useActivityFeed();

  // ── Social graph (Phase 6) ────────────────────────────────────────────────
  const followStats = useFollowsStore((s) => (user?.id ? s.stats[user.id] : undefined));
  const loadFollowStats = useFollowsStore((s) => s.loadStats);

  useEffect(() => {
    if (user?.id) void loadFollowStats(user.id);
  }, [user?.id, loadFollowStats]);

  const openFollows = useCallback(
    (which: "followers" | "following") => {
      if (!user?.id) return;
      haptics.tap();
      router.push({
        pathname: "/follows/[userId]",
        params: { userId: user.id, tab: which, name: user.full_name ?? "Connections" },
      } as never);
    },
    [user?.id, user?.full_name],
  );

  useEffect(() => {
    hydrateProgram(user ?? null);
  }, [user, hydrateProgram]);

  // Re-evaluate achievements whenever the inputs change (best-effort, idempotent).
  useEffect(() => {
    if (!user?.id) return;
    const creditsByType: Record<string, number> = {};
    for (const h of creditHistory) {
      creditsByType[h.type] = (creditsByType[h.type] ?? 0) + 1;
    }
    const trips = txHistory.filter((t) => t.kind === "trip_payment");
    const savings = trips.reduce(
      (s, t) => s + Math.max(0, (t.base_fare ?? 0) - (t.passenger_bank_paid ?? 0)),
      0
    );
    const maxFare = trips.reduce((m, t) => Math.max(m, t.base_fare ?? 0), 0);
    void evaluateAchievements(user.id, {
      credits,
      creditsByType,
      programStatus,
      tripCount: trips.length,
      savings,
      maxFare,
    });
  }, [user?.id, credits, creditHistory, programStatus, txHistory, evaluateAchievements]);

  // Load the device's stored account on mount. It backs the Email row when the
  // session hasn't carried one through yet.
  useEffect(() => {
    (async () => {
      const creds = await getBiometricCredentials();
      if (creds) setKnownEmail(creds.email);
    })();
  }, []);

  // Recent searches survive the app being closed — the first tap on a search
  // field is usually a repeat of the last one.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(RECENTS_KEY);
        if (raw) setRecents(JSON.parse(raw));
      } catch {
        /* a corrupt recents list is not worth surfacing */
      }
    })();
  }, []);

  const rememberQuery = useCallback((q: string) => {
    const term = q.trim();
    if (!term) return;
    setRecents((prev) => {
      const next = [term, ...prev.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(
        0,
        MAX_RECENTS,
      );
      AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearRecents = useCallback(() => {
    setRecents([]);
    AsyncStorage.removeItem(RECENTS_KEY).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user?.id || user.role !== "driver") return;
    const loadEarnings = async () => {
      const trips = await TripsStorage.getByDriverId(user.id);
      const completed = trips.filter((t) => t.status === "completed");
      const earned = completed.reduce((sum, trip) => {
        const passengerCount = 0;
        const durationMinutes = trip.end_time
          ? (new Date(trip.end_time).getTime() - new Date(trip.start_time).getTime()) / 60000
          : 0;
        return sum + Math.round(5 + passengerCount * 2 + Math.floor(durationMinutes / 30));
      }, 0);
      setTotalEarnedCoins(earned);
    };
    loadEarnings();
  }, [user]);

  const completedTrips = recentTrips.filter((t) => t.status === "completed").length;

  useEffect(() => {
    if (!user?.id) return;
    TripsStorage.getByDriverId(user.id).then((trips) =>
      setRecentTrips(trips.slice(-5).reverse())
    );
  }, [user?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (user?.id) {
        const trips = await TripsStorage.getByDriverId(user.id);
        setRecentTrips(trips.slice(-5).reverse());
      }
      if (user?.id) await loadFollowStats(user.id);
      await triggerSyncNow();
    } finally {
      setRefreshing(false);
    }
  }, [user?.id, loadFollowStats]);

  /**
   * Change the profile photo.
   *
   * This used to save `result.assets[0].uri` — a `file://` path inside the
   * picker's sandbox. It rendered on this phone and NOWHERE else, so everyone
   * looking at this profile saw a broken image, and so did the owner after a
   * reinstall. The picture is uploaded first now, and only the resulting public
   * URL is stored.
   */
  const pickPhoto = useCallback(async () => {
    haptics.tap();
    try {
      const picked = await pickFromLibrary();
      if (!picked) return;

      setPhotoUploading(true);
      const url = await uploadAvatar(picked.uri);
      await supabase.auth.updateUser({ data: { profile_photo: url } });
      updateUser({ profile_photo: url });
    } catch (e: any) {
      iosAlert("Could not update photo", e?.message ?? "Please try again.");
    } finally {
      setPhotoUploading(false);
    }
  }, [updateUser]);

  const startEdit = useCallback((field: string, currentValue: string) => {
    haptics.tap();
    setEditField(field);
    setEditValue(currentValue || "");
  }, []);

  const saveEdit = async () => {
    if (!editField) return;
    setSaving(true);
    try {
      const update: Record<string, string> = { [editField]: editValue.trim() };
      await supabase.auth.updateUser({ data: update });
      updateUser(update as any);
      setEditField(null);
    } catch {
      iosAlert("Error", "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Copy the handle people actually share.
   *
   * This used to copy `driver_id` while the chip beside it showed `@username`,
   * so the button copied something the user was not looking at — and it carried
   * a `hitSlop` of 912, a touch target larger than the screen, which swallowed
   * every tap in the header around it.
   */
  const handleCopy = useCallback(async () => {
    const handle = user?.username ? `@${user.username}` : user?.driver_id;
    if (!handle) return;
    await Clipboard.setStringAsync(handle);
    haptics.success();
    showCopied();
  }, [user?.username, user?.driver_id, showCopied]);

  const confirmSignOut = useCallback(() => {
    iosAlert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          const { signOut } = await import("@/src/services/supabase");
          const { logout } = useAuthStore.getState();
          await signOut();
          logout();
          // Cached follow stats are keyed by user id, so without this the next
          // account signing in on this device sees the last one's numbers.
          useFollowsStore.getState().reset();
          router.replace("/(auth)/login");
        },
      },
    ]);
  }, []);

  const addEmergencyContact = () => {
    if (!newContactName.trim() || !newContactPhone.trim()) return;
    const existing: EmergencyContact[] = (user as any)?.emergency_contacts || [];
    const updated = [
      ...existing,
      { name: newContactName.trim(), phone: newContactPhone.trim() },
    ];
    updateUser({ emergency_contacts: updated } as any);
    setNewContactName("");
    setNewContactPhone("");
    haptics.success();
  };

  const removeContact = (idx: number) => {
    const existing: EmergencyContact[] = (user as any)?.emergency_contacts || [];
    const updated = existing.filter((_, i) => i !== idx);
    updateUser({ emergency_contacts: updated } as any);
  };

  // ── Search wiring ─────────────────────────────────────────────────────────

  const searchIndex = useMemo(
    () =>
      buildProfileIndex({
        user,
        trips: recentTrips,
        activities,
        credits,
        achievementsEarned: Object.keys(unlockedAchievements ?? {}).length,
        isPartner: programStatus !== "none",
        followers: followStats?.followers,
        following: followStats?.following,
      }),
    [user, recentTrips, activities, credits, unlockedAchievements, programStatus, followStats],
  );

  const counts = useMemo(
    () => countByCategory(searchIndex, profileQuery),
    [searchIndex, profileQuery],
  );

  const hits = useMemo(
    () => searchProfileIndex(searchIndex, profileQuery, searchFilter),
    [searchIndex, profileQuery, searchFilter],
  );

  const searching = profileQuery.trim().length > 0;

  const filters: IOSFilterChip<ProfileSearchCategory | "all">[] = useMemo(
    () => [
      { key: "all", label: "All", count: searching ? counts.all : undefined },
      { key: "settings", label: "Settings", count: searching ? counts.settings : undefined },
      { key: "profile", label: "Details", count: searching ? counts.profile : undefined },
      { key: "activity", label: "Activity", count: searching ? counts.activity : undefined },
      { key: "actions", label: "Actions", count: searching ? counts.actions : undefined },
    ],
    [counts, searching],
  );

  /**
   * Act on a result.
   *
   * Anything that presents — the edit sheet, the QR sheet, an alert, a pushed
   * route — has to wait for this overlay to finish dismissing. iOS refuses to
   * present a second modal over one that is still animating away, and the
   * request is dropped silently rather than queued.
   */
  const runResult = useCallback(
    (item: ProfileSearchItem) => {
      rememberQuery(profileQuery);
      setSearchOpen(false);

      const after = (fn: () => void) => setTimeout(fn, 320);

      // Bind the target before the closures: TypeScript's narrowing of
      // `item.target` doesn't survive into a deferred callback.
      const target = item.target;

      switch (target.kind) {
        case "route":
          after(() => router.push(target.route as never));
          break;
        case "pane":
          setTab(target.pane);
          break;
        case "action":
          switch (target.action) {
            case "edit-field":
              after(() => startEdit(target.field!, target.value ?? ""));
              break;
            case "change-photo":
              after(pickPhoto);
              break;
            case "show-qr":
              after(() => setReceiveVisible(true));
              break;
            case "sign-out":
              after(confirmSignOut);
              break;
            case "copy-username":
              void handleCopy();
              break;
          }
          break;
      }
    },
    [profileQuery, rememberQuery, startEdit, pickPhoto, confirmSignOut, handleCopy],
  );

  const results: IOSSearchResult[] = useMemo(
    () =>
      hits.map((h) => ({
        id: h.id,
        title: h.title,
        subtitle: h.subtitle,
        symbol: h.symbol,
        group: h.group,
        onPress: () => runResult(h),
      })),
    [hits, runResult],
  );

  const openSearch = useCallback(() => setSearchOpen(true), []);

  // ── Chrome ────────────────────────────────────────────────────────────────

  const barHeight = insets.top + BAR_ROW_HEIGHT;
  const displayName = user?.full_name || "No user";
  // const handle = user?.username ? `@${user.username}` : user?.driver_id ?? "";
  // const roleLabel =
  //   user?.role === "driver"
  //     ? "Driver"
  //     : user?.role === "park_owner"
  //       ? "Park Owner"
  //       : "Passenger";

  const renderBar = useCallback(
    (collapsed: boolean) => (
      <View style={[styles.barRoot, { paddingTop: insets.top }]} pointerEvents="box-none">
        {/* The bar materialises its glass on a threshold rather than fading it
            in — opacity above a GlassView renders the effect wrong. */}
        <Glass
          variant="regular"
          present={collapsed}
          animated
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={100}
          fallbackTint={isDark ? "rgba(7,7,7,0.72)" : "rgba(255,255,255,0.78)"}
          androidTint={isDark ? "rgba(7,7,7,0.9)" : "rgba(255,255,255,0.92)"}
        />

        <View style={[styles.barRow]} pointerEvents="box-none">
          {/* The avatar docks here, but it is drawn by TravellingAvatar outside
              this bar — a child of the bar would be clipped by it at rest, and
              at rest the avatar is a whole hero below. This only holds its
              place so the centre slot stays centred. */}
          <View style={styles.barLeft} pointerEvents="none" />
          {/* Same centre slot as every other screen: the connection takes it
              over the moment it degrades, and hands it back on recovery. */}
          <View style={[styles.barCentre]} pointerEvents="none">
            <NetworkStatus>
              <BarFade visible={collapsed}>
                <Text
                  numberOfLines={1}
                  style={[IOSAppFont.label, { color: textColor, fontFamily: "Poppins_600SemiBold" }]}
                >
                  {displayName}
                </Text>
              </BarFade>
            </NetworkStatus>
          </View>



          {/* <View style={[styles.barRight, { backgroundColor: isDark ? Colors.borderLight : Colors.background, padding: 8, borderRadius: 50, alignItems: 'center', justifyContent: 'center' }]}>    
            <Glass
              variant="regular"
              interactive
              radius={30}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              fallbackIntensity={40}
              fallbackTint={ios.systemGray3}
            />
            <BarButton icon={Search02Icon} label="Search profile" onPress={openSearch} color={textColor} />
            {user?.role === "driver" && (
              <BarButton
                icon={QrCode01Icon}
                label="My QR code"
                onPress={() => setReceiveVisible(true)}
                color={textColor}
              />
            )}
            <BarButton icon={LogoutIcon} label="Sign out" onPress={confirmSignOut} color={textColor} />
          </View> */}


          <View >

              {/* Glass, not a coloured pill. */}
              <Glass
                variant="regular"
                interactive
                radius={CARD_RADIUS}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
                fallbackIntensity={40}
                fallbackTint={ios.tertiarySystemFill}
              />
              
            {/* backgroundcolor: ios.scheme === "dark" ? "rgba(120,120,128,0.22)" : "rgba(120,120,128,0.12)"*/}
            <View style={[styles.menuListContent, {borderWidth: 0, borderColor: ios.opaqueSeparator, alignItems:'center',justifyContent:'center'}]}>
              <HugeiconsIcon
                icon={Search02Icon}
                size={24}
                color={textColor}
                onPress={openSearch}
              />


              {/* <SymbolView name="person.fill" size={22} tintColor={ios.label}  fallback={ios.label} /> */}
              {/* {user?.role === "driver" && ( */}
                <HugeiconsIcon
                  icon={Logout02Icon}
                  size={24}
                  color={textColor}
                  onPress={confirmSignOut} 
                  // onPress={() => setReceiveVisible(true)}
                />
              {/* )} */}
            </View>
          </View>
        </View>
      </View>
    ),
    // [insets.top, isDark, displayName, user?.role, textColor, openSearch, confirmSignOut, ios.systemGray3],
    [confirmSignOut, displayName, insets.top, ios.opaqueSeparator, ios.tertiarySystemFill, isDark, openSearch, textColor],
  );

  return (
    <CopyToastContext.Provider value={showCopied}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: bg,  }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <StatusBar style={isDark ? "light" : "dark"} animated />
        <CopyToast nonce={copyNonce} />

        <SwipeableTabs
          segments={PROFILE_TABS}
          active={tab}
          onChange={setTab}
          variant="capsule"
          barHeight={barHeight}
          renderBar={renderBar}
          scrollY={scrollY}
          stripInset={10}
          contentContainerStyle={{ paddingBottom: bottomInset + 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              progressViewOffset={barHeight}
              tintColor={Colors.primary}
            />
          }
          header={
            <View style={[styles.hero, 
            {backgroundColor: ios.tertiarySystemFill
, borderWidth: 0, borderColor: ios.opaqueSeparator, borderRadius: CARD_RADIUS, marginHorizontal: 10, marginBottom: 6 }

            ]}>
              <View style={[styles.heroRow, { }]}>
                {/* The avatar is drawn by TravellingAvatar, outside the scroll.
                    This reserves exactly its footprint so the text sits where it
                    always did — and because the row aligns to flex-start, the
                    slot's top-left IS the coordinate that overlay starts from. */}
                <View style={[styles.avatarSlot, { }]} />

                <View style={styles.heroText}>
                  <Text numberOfLines={1} style={[styles.heroName, { color: textColor }]}>
                    {displayName}
                  </Text>

                  {/* Username, directly under the name — for every role.
                      It used to fall back to the driver ID when no username was
                      set, which labelled an ID as a handle. They are different
                      things and now render as separate chips. */}
                  <View style={styles.handleRow}>
                    {user?.username ? (
                      <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center'}}>

                          {/* <Text style={[{fontFamily: "Poppins_500SemiBold", fontSize: 13}, { color: ios.systemGray2 }]}> Username • </Text> */}
                          <Pressable
                            style={styles.handleChip}
                            onPress={handleCopy}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Copy username @${user.username}`}
                          >
                            {/* <Glass
                              variant="clear"
                              interactive
                              radius={30}
                              style={StyleSheet.absoluteFill}
                              pointerEvents="none"
                              fallbackIntensity={26}
                              fallbackTint={ios.tertiarySystemFill}
                            /> */}
                            <Text numberOfLines={1} style={[styles.handleText, {color: Colors.primary}]}>
                              @{user.username}
                            </Text>
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      // People message each other by handle, so an unset one is
                      // worth prompting for rather than leaving blank.
                      <Pressable
                        style={styles.handleChip}
                        onPress={() => startEdit("username", "")}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Set a username"
                      >
                        {/* <Glass
                          variant="clear"
                          interactive
                          radius={30}
                          style={StyleSheet.absoluteFill}
                          pointerEvents="none"
                          fallbackIntensity={26}
                          fallbackTint={ios.tertiarySystemFill}
                        /> */}
                        <Text numberOfLines={1} style={[styles.handleText, { color: Colors.primary }]}>
                          Set a username
                        </Text>
                      </Pressable>
                    )}

                    {/* {!!user?.driver_id && (
                      <View style={styles.handleChip}>
                      
                        <Text numberOfLines={1} style={[styles.handleText, { color: Colors.primary }]}>
                        <Text style={[{fontFamily: "Poppins_500SemiBold", fontSize: 13}, { color: ios.systemGray2 }]}> ID • </Text>
                          {user.driver_id}
                        </Text>
                      </View>
                    )} */}

                    <Pressable
                      onPress={handleCopy}
                      hitSlop={12}
                      style={styles.copyBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Copy username"
                    >
                      <HugeiconsIcon icon={Copy02Icon as any} size={14} fill={Colors.primary} color={Colors.primary} />
                    </Pressable>
                  </View>

                  <View style={styles.roleRow}>
                    {/* <Text style={[styles.roleLabel, { color: subTextColor }]}>{roleLabel}</Text> */}
                    {!!user?.avg_rating && (
                      <>
                        <View style={[styles.dot, { backgroundColor: subTextColor }]} />
                        <HugeiconsIcon icon={Star as any} size={12} color={Colors.gold} />
                        <Text style={[styles.roleLabel, { color: subTextColor }]}>
                          {user.avg_rating.toFixed(1)}
                        </Text>
                      </>
                    )}
                  </View>


                  {/* Followers / following. Counts open the same screen on
                      different tabs — tapping a number should land on that number's
                      list, not make you find it. */}
                  <View style={styles.followRow}>
                    <Pressable
                      onPress={() => openFollows("followers")}
                      hitSlop={8}
                      style={styles.followStat}
                      accessibilityRole="button"
                      accessibilityLabel={`${followStats?.followers ?? 0} followers`}
                    >
                      <Text style={[styles.followValue, { color: textColor }]}>
                        {followStats?.followers ?? 0}
                      </Text>
                      <Text style={[styles.followLabel, { color: subTextColor }]}>Followers</Text>
                    </Pressable>

                    <View style={[styles.followDivider, { backgroundColor: textColor }]} />

                    <Pressable
                      onPress={() => openFollows("following")}
                      hitSlop={8}
                      style={styles.followStat}
                      accessibilityRole="button"
                      accessibilityLabel={`${followStats?.following ?? 0} following`}
                    >
                      <Text style={[styles.followValue, { color: textColor }]}>
                        {followStats?.following ?? 0}
                      </Text>
                      <Text style={[styles.followLabel, { color: subTextColor }]}>Following</Text>
                    </Pressable>
                  </View>
                </View>
              </View>


              {/* Full-width search across the header. A button, not a field —
                  the overlay owns the live one. */}
              {/* <View style={styles.headerSearch}>
                <IOSSearchBar
                  asButton
                  value={profileQuery}
                  onChangeText={setProfileQuery}
                  onPress={openSearch}
                  placeholder="Search settings, details and activity"
                />
              </View> */}
            </View>
          }
        >
          <View style={styles.paneContent}>
            {/* ── Profile: balance, stats, credit ── */}
            {tab === "profile" && (
              <>


                {user?.role === "driver" ? (
                  <View style={[styles.coinbalanceSection, { backgroundColor: ios.tertiarySystemFill, borderWidth: 0, borderColor: ios.opaqueSeparator }]}>
                    <DriverDashboard />
                  </View>
                ) : user?.role === "passenger" ? (
                  <View style={[styles.coinbalanceSection, { backgroundColor: ios.tertiarySystemFill, borderWidth: 0, borderColor: ios.opaqueSeparator }]}>
                    <PassengerDashboard />
                  </View>
                ) : (
                      <View style={[styles.coinbalanceSection,
                        { backgroundColor: ios.tertiarySystemFill, borderWidth: 0, borderColor: ios.opaqueSeparator }
                      ]}>
                    <BalanceCard coins={totalEarnedCoins} onQuickTransferPress={() => {}} />
                  </View>
                )}


                {/* ── Earnings summary strip ── */}
                {user?.role === "driver" && (
                  <GlassCard style={styles.statsCard} padded={false}>
                    <View style={styles.statsStrip}>
                      <View style={styles.statInner}>
                        <StatPill
                          iconName={CheckmarkBadge01Icon}
                          label="Trips"
                          value={recentTrips.length.toString()}
                          color={textColor}
                        />
                        <StatPill
                          iconName={Trophy}
                          label="Completed"
                          value={completedTrips.toString()}
                          color={textColor}
                        />
                      </View>

                      <View style={styles.statInner}>
                        <StatPill
                          iconName={Wallet}
                          label="Earned"
                          // value={formatCs(totalEarnedCoins)}
                          value={formatNaira(totalEarnedCoins)}
                          color={textColor}
                        />
                        <StatPill
                          iconName={Star}
                          label="Rating"
                          value={user?.avg_rating ? user.avg_rating.toFixed(1) : "—"}
                          color={textColor}
                        />
                      </View>
                    </View>
                  </GlassCard>
                )}

                {/* ── Step 7: credit meter · partner CTA · achievements ── */}
                <CreditMeter textColor={textColor} subColor={subTextColor} cardBg={cardBg} />
              </>
            )}

            {/* ── Account Settings: every settings section, plus identity ── */}
            {tab === "settings" && (
              <>
                {user?.role || !user?.role  && (
                // {showPersonalInfo && (
                  <GlassCard style={styles.cardSpacing}>
                    <View style={styles.cardHeadTitle}>
                      <HugeiconsIcon icon={Hospital} size={20} color={textColor} />
                      <Text style={[styles.cardTitle, { color: textColor }]}>
                        General Settings
                      </Text>
                    </View>

                    <View style={[styles.generalRowSettings, {backgroundColor:'transparent', padding: 0, margin: 0}]}>
                      <IOSListSection>
                        {SETTINGS_SECTIONS.map((s) => (
                          <IOSListRow
                            key={s.id}
                            symbol={s.symbol as never}
                            label={s.title}
                            detail={s.summary}
                            accessory={{ type: "disclosure" }}
                            onPress={() => {
                              haptics.tap();
                              router.push(s.route as never);
                            }}
                          />
                        ))}
                      </IOSListSection>
                    </View>
                  </GlassCard>
                )}


                {/* Personal Information */}
                <GlassCard style={styles.cardSpacing}>
                  <Pressable
                    style={styles.cardHead}
                    onPress={() => setShowPersonalInfo((v) => !v)}
                    hitSlop={8}
                  >
                    <View style={styles.cardHeadTitle}>
                      <HugeiconsIcon icon={UserIcon} size={20} color={textColor} />
                      <Text style={[styles.cardTitle, { color: textColor }]}>
                        Personal Information
                      </Text>
                    </View>
                    <HugeiconsIcon
                      icon={showPersonalInfo ? ChevronRight : ChevronDown}
                      size={22}
                      color={textColor}
                    />
                  </Pressable>

                  {showPersonalInfo && (
                    <View style={[styles.generalRowSettings, {backgroundColor:ios.tertiarySystemFill, paddingHorizontal: 10}]}>
                      <InfoRow
                        icon={UserIcon}
                        label="Name"
                        value={user?.full_name || ""}
                        editable
                        onEdit={() => startEdit("full_name", user?.full_name || "")}
                        textColor={textColor}
                        subTextColor={subTextColor}
                        borderColor={borderColor}
                      />
                      <InfoRow
                        icon={Mail01Icon}
                        label="Email"
                        value={user?.email || knownEmail || ""}
                        textColor={textColor}
                        subTextColor={subTextColor}
                        borderColor={borderColor}
                      />
                      <InfoRow
                        icon={CallIcon}
                        label="Phone"
                        value={user?.phone || ""}
                        editable
                        onEdit={() => startEdit("phone", user?.phone || "")}
                        textColor={textColor}
                        subTextColor={subTextColor}
                        borderColor="transparent"
                      />
                    </View>
                  )}
                </GlassCard>

                {/* Driver Details */}
                {user?.role === "driver" && (
                  <GlassCard style={styles.cardSpacing}>
                    <Pressable
                      style={styles.cardHead}
                      onPress={() => setShowDriverDetails((v) => !v)}
                      hitSlop={8}
                    >
                      <View style={styles.cardHeadTitle}>
                        <HugeiconsIcon icon={Car01Icon} size={20} color={textColor} />
                        <Text style={[styles.cardTitle, { color: textColor }]}>Driver Details</Text>
                      </View>
                      <HugeiconsIcon
                        icon={showDriverDetails ? ChevronRight : ChevronDown}
                        size={22}
                        color={textColor}
                      />
                    </Pressable>

                    {showDriverDetails && (
                      <View style={[styles.generalRowSettings, {backgroundColor:ios.tertiarySystemFill}]}>
                        <InfoRow
                          icon={CarIcon}
                          label="Vehicle"
                          value={user?.vehicle_details || ""}
                          editable
                          onEdit={() => startEdit("vehicle_details", user?.vehicle_details || "")}
                          textColor={textColor}
                          subTextColor={subTextColor}
                          borderColor={borderColor}
                        />
                        <InfoRow
                          icon={BuildingIcon}
                          label="Park Name"
                          value={user?.park_name || ""}
                          editable
                          onEdit={() => startEdit("park_name", user?.park_name || "")}
                          textColor={textColor}
                          subTextColor={subTextColor}
                          borderColor={borderColor}
                        />
                        <InfoRow
                          icon={LocationIcon}
                          label="Park Location"
                          value={user?.park_location || ""}
                          editable
                          onEdit={() => startEdit("park_location", user?.park_location || "")}
                          textColor={textColor}
                          subTextColor={subTextColor}
                          borderColor="transparent"
                        />
                      </View>
                    )}
                  </GlassCard>
                )}

                {/* Park Owner Details */}
                {user?.role === "park_owner" && (
                  <GlassCard style={styles.cardSpacing}>
                    <Pressable
                      style={styles.cardHead}
                      onPress={() => setParkExpanded((v) => !v)}
                      hitSlop={8}
                    >
                      <View style={styles.cardHeadTitle}>
                        <HugeiconsIcon icon={BuildingIcon} size={20} color={textColor} />
                        <Text style={[styles.cardTitle, { color: textColor }]}>Park Details</Text>
                      </View>
                      <HugeiconsIcon
                        icon={parkExpanded ? ChevronRight : ChevronDown}
                        size={22}
                        color={textColor}
                      />
                    </Pressable>

                    {parkExpanded && (
                      <View style={[styles.generalRowSettings, {backgroundColor:ios.tertiarySystemFill}]}>
                        <InfoRow
                          icon={BuildingIcon}
                          label="Park Name"
                          value={user?.park_name || ""}
                          editable
                          onEdit={() => startEdit("park_name", user?.park_name || "")}
                          textColor={textColor}
                          subTextColor={subTextColor}
                          borderColor={borderColor}
                        />
                        <InfoRow
                          icon={LocationIcon}
                          label="Park Location"
                          value={user?.park_location || ""}
                          editable
                          onEdit={() => startEdit("park_location", user?.park_location || "")}
                          textColor={textColor}
                          subTextColor={subTextColor}
                          borderColor="transparent"
                        />
                      </View>
                    )}
                  </GlassCard>
                )}

                {/* Emergency Contacts */}
                {user?.role && (
                  <GlassCard style={styles.cardSpacing}>
                    <View style={styles.cardHeadTitle}>
                      <HugeiconsIcon icon={Hospital} size={20} color={textColor} />
                      <Text style={[styles.cardTitle, { color: textColor }]}>
                        Emergency Contacts
                      </Text>
                    </View>

                    {(((user as any)?.emergency_contacts as EmergencyContact[]) || []).map(
                      (c, idx) => (
                        <View key={idx} style={[styles.contactRow, { borderBottomColor: borderColor }, ]}>
                          <View style={[styles.contactAvatar, { backgroundColor: Colors.primaryLight }]}>
                            <Text style={[styles.contactInitial, { color: Colors.primary }]}>
                              {c.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.contactName, { color: textColor }]}>{c.name}</Text>
                            <Text style={[styles.contactPhone, { color: subTextColor }]}>
                              {c.phone}
                            </Text>
                          </View>
                          <Pressable onPress={() => removeContact(idx)} hitSlop={8}>
                            <HugeiconsIcon icon={Close} size={20} color={Colors.error} />
                          </Pressable>
                        </View>
                      ),
                    )}

                    <View style={[styles.addContactRow, styles.generalRowSettings]}>
                      <TextInput
                        style={[styles.addInput, { backgroundColor: cardBg, color: textColor }]}
                        placeholder="Name"
                        placeholderTextColor={subTextColor}
                        value={newContactName}
                        onChangeText={setNewContactName}
                      />
                      <TextInput
                        style={[styles.addInput, { flex: 1.5, backgroundColor: cardBg, color: textColor }]}
                        placeholder="Phone"
                        placeholderTextColor={subTextColor}
                        keyboardType="phone-pad"
                        value={newContactPhone}
                        onChangeText={setNewContactPhone}
                      />
                      <Pressable
                        style={[styles.addBtn, { backgroundColor: Colors.primary }]}
                        onPress={addEmergencyContact}
                      >
                        <HugeiconsIcon icon={AddCircleIcon as any} size={30} color="#fff" />
                      </Pressable>
                    </View>
                  </GlassCard>
                )}
              </>
            )}

            {/* ── Activity: achievements and recent history ── */}
            {tab === "activity" && (
              <>
                <AchievementsCard
                  textColor={textColor}
                  subColor={subTextColor}
                  cardBg={cardBg}
                  borderColor={borderColor}
                />

                {/* Recent activity (unified history: trips · payments · rewards · ads) */}
                <GlassCard style={[styles.cardSpacing, {padding: 0, margin: 0}]}>
                  <View style={styles.cardHead}>
                    <Text style={[styles.cardTitle, { color: textColor }]}>Recent activity</Text>
                    <Pressable
                      onPress={() =>
                        router.push(
                          (user?.role === "driver"
                            ? "/(driver)/history"
                            : "/(passenger)/history") as any,
                        )
                      }
                      hitSlop={8}
                    >
                      <Text style={styles.seeAll}>See all</Text>
                    </Pressable>
                  </View>

                  <ActivityFeed
                    activities={activities}
                    textColor={textColor}
                    subColor={subTextColor}
                    cardBg={isDark ? "rgba(255,255,255,0.04)" : "#F7F9FB"}
                    borderColor={borderColor}
                    limit={5}
                    emptyText="No activity yet. Your trips, payments and rewards will show here."
                  />
                </GlassCard>
              </>
            )}
          </View>
        </SwipeableTabs>

        {/* Drawn after SwipeableTabs so it sits above the pinned bar it docks
            into, and outside it so nothing clips it on the way up. */}
        <TravellingAvatar
          scrollY={scrollY}
          insetTop={insets.top}
          barHeight={barHeight}
          name={displayName}
          photoUri={user?.profile_photo}
          // Guarded, not just disabled-looking: tapping again mid-upload starts
          // a second picker and a second upload of the same face.
          onPress={photoUploading ? () => {} : pickPhoto}
          badgeBg={bg}
          badgeColor={textColor}
        />

        {photoUploading ? (
          <View style={[styles.photoUploading, { top: insets.top + 6 }]} pointerEvents="none">
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.photoUploadingText}>Uploading photo…</Text>
          </View>
        ) : null}

        {/* Search: one field, the whole screen's contents behind it. */}
        <IOSSearchOverlay
          visible={searchOpen}
          onClose={() => {
            rememberQuery(profileQuery);
            setSearchOpen(false);
          }}
          query={profileQuery}
          onChangeQuery={setProfileQuery}
          placeholder="Search"
          filters={filters}
          activeFilter={searchFilter}
          onChangeFilter={setSearchFilter}
          results={results}
          recents={recents}
          onSelectRecent={setProfileQuery}
          onClearRecents={clearRecents}
          suggestions={SEARCH_SUGGESTIONS}
          emptyHint="Try a setting, a field on your profile, or somewhere you've travelled."
        />

        {/* Edit Modal Sheet with Smooth Slide Animation */}
        <Modal
          visible={!!editField}
          transparent
          animationType="slide"
          onRequestClose={() => setEditField(null)}
        >
          <KeyboardAvoidingView
            style={styles.editOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditField(null)} />
            <View style={[styles.editSheet, { backgroundColor: modalBg }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={[styles.editTitle, { color: textColor }]}>
                  Edit {editField?.replace("_", " ")}
                </Text>
                <View style={styles.editActions}>
                  <Pressable
                    style={[styles.editCancelBtn, { borderColor: Colors.error }]}
                    onPress={() => setEditField(null)}
                  >
                    <HugeiconsIcon icon={Close} size={20} color={Colors.error} />
                  </Pressable>
                  <Pressable
                    style={[styles.editSaveBtn, { backgroundColor: Colors.primary }]}
                    onPress={saveEdit}
                    disabled={saving}
                  >
                    {saving ? (
                      <Text style={[styles.editSaveText, { color: "#fff" }]}>Saving...</Text>
                    ) : (
                      <HugeiconsIcon icon={Tick02FreeIcons} size={20} color="#fff" />
                    )}
                  </Pressable>
                </View>
              </View>
              <TextInput
                style={[styles.editInput, { color: textColor, borderColor, backgroundColor: borderColor }]}
                value={editValue}
                onChangeText={setEditValue}
                autoFocus
                onSubmitEditing={saveEdit}
              />
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <FindDriverModal visible={finderVisible} onClose={() => setFinderVisible(false)} />

        <QuickReceiveModal
          visible={receiveVisible}
          onClose={() => setReceiveVisible(false)}
          driverId={user?.driver_id}
        />
      </KeyboardAvoidingView>
    </CopyToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  photoUploading: {
    position: "absolute", alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    zIndex: 50,
  },
  photoUploadingText: { fontFamily: "Poppins_500Medium", fontSize: 12.5, color: "#fff" },

  // ── Pinned bar ─────────────────────────────────────────────────────────────
  barRoot: { flex: 1, overflow: "hidden" },
  barRow: {
    height: BAR_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
  },
  barLeft: { width: 74, alignItems: "flex-start" },
  barCentre: { flex: 1, alignItems: "center", justifyContent: "center" },
  barRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  barBtn: {
    width: 38,
    height: 38,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },


  menuListContent: {
    borderRadius: 30,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 22,
    zIndex: 20
  },


  // ── Hero ───────────────────────────────────────────────────────────────────
  hero: { paddingHorizontal: HERO_INSET, paddingTop: HERO_PAD_TOP },
  // flex-start, not center: it makes the slot's top edge exactly the hero's
  // content top, which is the coordinate TravellingAvatar starts from.
  // heroRow: { flexDirection: "row", alignItems: "flex-start", gap: 14,  },
  heroRow: { flexDirection: "column", alignItems: "center", gap: 14, },
  avatarSlot: { width: AVATAR_BOX, height: AVATAR_BOX },
  avatarTravel: {
    position: "absolute",
    top: 0,
    // left: HERO_INSET,
    alignSelf:'center',
    width: AVATAR_BOX,
    height: AVATAR_BOX,
    zIndex: 40,
  },
  heroText: { flex: 1, gap: 5, paddingTop: 2, textAlign:'center', alignItems:'center' },
  avatarWrap: {
    position: "relative",
    borderWidth: 2,
    borderRadius: 100,
    padding: 2,
    borderColor: Colors.primary,
  },
  cameraBtn: {
    position: "absolute",
    bottom: 2,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  heroName: { fontFamily: "Poppins_700Bold", fontSize: 21 },
  handleRow: { flexDirection: "row", alignItems: "center", gap: 0 },
  handleChip: {
    flexShrink: 1,
    // paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 30,
    overflow: "hidden",
  },
  handleText: { fontFamily: "Poppins_600SemiBold", fontSize: 12, color: Colors.warning },
  copyBtn: {
    width: 28,
    height: 28,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  roleLabel: { fontFamily: "Poppins_400Regular", fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2 },
  followRow: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 6, marginBottom: 20 },
  followStat: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  followValue: { fontFamily: "Poppins_700Bold", fontSize: 15 },
  followLabel: { fontFamily: "Poppins_400Regular", fontSize: 12 },
  followDivider: { width: StyleSheet.hairlineWidth, height: 14 },
  headerSearch: { marginTop: 16, marginHorizontal: -16 },

  // ── Panes ──────────────────────────────────────────────────────────────────
  paneContent: { paddingHorizontal: 0, paddingTop: 4 },
  cardShadow: {
    borderRadius: CARD_RADIUS,
    // shadowColor: "#000",
    // shadowOffset: { width: 0, height: 6 },
    // shadowOpacity: 0.06,
    // shadowRadius: 14,
    // elevation: 3,
  },
  cardClip: { overflow: "hidden" },
  cardInner: { paddingVertical: 12, paddingHorizontal: 10, gap: 14 },
  cardSpacing: { marginTop: 0,  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardHeadTitle: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 14, textAlign: "left" },
  seeAll: { fontFamily: "Poppins_500Medium", fontSize: 14, color: Colors.primary },
  partnerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 30,
    paddingVertical: 15,
    marginTop: 12,
    marginBottom: 10,
  },
  partnerBtnText: { fontFamily: "Poppins_600SemiBold", fontSize: 14, color: "#fff" },
  coinbalanceSection: {
    padding: 10,
    borderRadius: CARD_RADIUS,
    marginVertical: 12,
    marginHorizontal: 10
  },
  statsCard: { marginBottom: 12 },
  statsStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    paddingVertical: 6,
  },
  statInner: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 22,
    padding: 18,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    
  },
  contactAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  contactInitial: { fontFamily: "Poppins_700Bold", fontSize: 15 },
  contactName: { fontFamily: "Poppins_500Medium", fontSize: 14 },
  contactPhone: { fontFamily: "Poppins_400Regular", fontSize: 12, marginTop: 2 },
  addContactRow: { flexDirection: "row", gap: 8, marginTop: 12, alignItems: "center" },
  addInput: {
    flex: 1,
    borderRadius: 30,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Poppins_400Regular",
    fontSize: 13,
  },
  addBtn: { width: 40, height: 40, borderRadius: 30, alignItems: "center", justifyContent: "center" },

  generalRowSettings: {
    marginHorizontal: 0, padding: 10, borderRadius: 30
  },
  // ── Edit sheet ─────────────────────────────────────────────────────────────
  editOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0 0 0 / 0.77)",
    justifyContent: "flex-end",
    zIndex: 200,
  },
  editSheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 34,
    paddingBottom: 190,
    gap: 16,
    top: 100,
  },
  editTitle: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 16,
    textTransform: "capitalize",
    alignSelf: "flex-end",
  },
  editInput: {
    borderWidth: 0.5,
    borderRadius: 54,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: "Poppins_400Regular",
    fontSize: 15,
  },
  editActions: { flexDirection: "row", gap: 12, justifyContent: "center" },
  editCancelBtn: { borderWidth: 0.5, borderRadius: 54, padding: 13, alignItems: "center" },
  editSaveBtn: { borderRadius: 54, padding: 13, alignItems: "center" },
  editSaveText: { fontFamily: "Poppins_600SemiBold", fontSize: 14, color: Colors.primary },
});
