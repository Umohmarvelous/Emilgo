import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Platform,
  Animated,
  PanResponder,
  Dimensions,
  Image,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { useSettingsStore } from "@/src/store/useSettingsStore";
import { useMessagesStore } from "@/src/store/useMessagesStore";
import { Colors } from "@/constants/colors";
import ProfileTab from "./profile";
import MessagesTab from "./messages";
import NotificationsTab from "./notifications";
import DiscoverTab from "./discover";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  HomeIcon,
  Home01Icon,
  MessageIcon,
  Message01Icon,
  Bell,
  Menu03Icon,
  Console,
} from "@hugeicons/core-free-icons";
import {
  Glass,
  IOSSegmentedTabs,
  IOSTabBar,
  NetworkStatus,
  TAB_BAR_HEIGHT,
  TAB_BAR_BOTTOM_GAP,
  type IOSSegment,
  type IOSTab,
  useIOSTheme,
} from "@/components/ios";
import HeaderActions from "@/components/HeaderActions";
import { useUnreadNotificationCount } from "@/src/store/useNotificationsStore";
import Avatar from "@/components/Avatar";
import { useAuthStore } from "@/src/store/useStore";
// import BottomSheet from "@gorhom/bottom-sheet";
import MainTab from "./index";
import SidedBar from "@/components/Sidedbar";
import FindDriverModal from "@/components/FindDriverModal";
import OnboardingOverlay from "@/components/OnboardingOverlay";
import { useOnboarding } from "@/src/hooks/useOnboarding";
import GameTab from "./game";

type Tab = "home" | "game" | "profile" | "messages" | "notifications";
type TopTab = "home" | "discover";

/**
 * Bottom tabs — Emilgo's own Hugeicons set, paired outline/filled for the
 * unselected/selected states. The "You" tab renders the user's avatar instead
 * of a glyph, as it did before.
 */
const TABS: IOSTab[] = [
  { key: "home",     label: "Home",     icon: Home01Icon,     iconActive: HomeIcon },
  { key: "game", label: "Game", icon: Console, iconActive: Console},
  { key: "profile",  label: "You" },
  { key: "messages", label: "Chat", icon: Message01Icon,  iconActive: MessageIcon },
  { key: "notifications", label: "Notifications", icon: Bell, iconActive: Bell},
];

/** The home screen's two panes, as a segmented control. */
const TOP_TABS: IOSSegment<TopTab>[] = [
  { key: "home", label: "Home" },
  { key: "discover", label: "For You" },
];

const SIDEBAR_WIDTH = 330;
const EDGE_WIDTH = 60;
// How far to pull the home screen LEFT of the fully-open position.
// Positive = home rests further left (overlaps sidebar's right edge); negative = further right; 0 = flush with sidebar width.
const HOME_OPEN_SHIFT = 30;

// ── Sidebar gesture "feel" — tweak these to taste ────────────────────────────
// Drag the home screen right by more than this many px, then let go, and the
// sidebar snaps fully OPEN. Small number = very easy to open (a ~1cm pull is
// enough) and it will NOT spring back closed after a short drag.
const OPEN_THRESHOLD = 15;
// While open, drag back left by more than this many px to snap it CLOSED.
const CLOSE_THRESHOLD = 40;
// A quick flick faster than this (px per ms) opens/closes regardless of distance.
const FLICK_VELOCITY = 0.15;

// ── Rounded "card" look of the home screen while the sidebar is open ─────────
const HOME_BORDER_RADIUS = 40;
const HOME_BORDER_WIDTH = 1;

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function MainLayout() {
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const { conversations } = useMessagesStore();
  const user = useAuthStore((s) => s.user);
  // One source for every notification count in the app — the bell here, and the
  // Notifications tab below.
  const unreadNotifications = useUnreadNotificationCount();

  const ios = useIOSTheme();

    
  const { shouldShow, isLoaded, complete } = useOnboarding();

  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [activeTopTab, setActiveTopTab] = useState<TopTab>("home");
  const [finderVisible, setFinderVisible] = useState(false);

  const sidebarOpen = useRef(false);
  const sidebarAnim = useRef(new Animated.Value(0)).current;
  // State mirror of the ref so the dim overlay's pointerEvents actually re-renders.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // --- Horizontal Top Tab Scroll Setup ---
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  // --- Scroll Animation Setup for "For You" Feed ---
  const feedScrollY = useRef(new Animated.Value(0)).current;

  // iOS 26 `.tabBarMinimizeBehavior(.onScrollDown)`: the tab bar shrinks on the
  // way down to hand the screen back to content, and returns on the way up.
  const [tabBarMinimized, setTabBarMinimized] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const id = feedScrollY.addListener(({ value }) => {
      const dy = value - lastScrollY.current;
      // Ignore jitter and rubber-banding at the very top.
      if (Math.abs(dy) < 8) return;
      lastScrollY.current = value;
      setTabBarMinimized(dy > 0 && value > 48);
    });
    return () => feedScrollY.removeListener(id);
  }, [feedScrollY]);

  // Prevent iOS bounce from causing erratic clamping
  const clampedScrollY = feedScrollY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolateLeft: "clamp",
  });

  const scrollClamp = Animated.diffClamp(clampedScrollY, 0, 150);

  const rawHeaderTranslateY = scrollClamp.interpolate({
    inputRange: [0, 150],
    outputRange: [0, -150],
    extrapolate: "clamp",
  });

  // Conditionally multiply the clamping so it ONLY applies when scrollX is looking at Discover tab
  const hideMultiplier = scrollX.interpolate({
    inputRange: [0, SCREEN_WIDTH],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const actualHeaderTranslateY = Animated.multiply(
    rawHeaderTranslateY,
    hideMultiplier,
  );
  // -----------------------------

  const openSidebar = useCallback(() => {
    sidebarOpen.current = true;
    setIsSidebarOpen(true);
    Animated.spring(sidebarAnim, {
      toValue: SIDEBAR_WIDTH,
      speed: 22,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sidebarAnim]);

  const closeSidebar = useCallback(() => {
    sidebarOpen.current = false;
    Animated.spring(sidebarAnim, {
      toValue: 0,
      speed: 22,
      bounciness: 0,
      useNativeDriver: true,
    }).start(() => setIsSidebarOpen(false));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sidebarAnim]);

  const isSidebarGesture = useRef(false);
  const panX = useRef(0);

  /**
   * panResponder — the low-level touch tracker for the sidebar swipe.
   *
   * A PanResponder is just a bundle of callbacks that React Native calls while
   * a finger is dragging on screen. We use it to (1) recognise a horizontal
   * "open the sidebar" swipe, (2) move the sidebar 1-to-1 with the finger, and
   * (3) on release, snap it fully OPEN or fully CLOSED. The comments beside each
   * callback below explain exactly what that callback does and when it fires.
   */
  const panResponder = useRef(
    PanResponder.create({
      // Fires the instant a finger touches down. We return false so a plain tap
      // is never captured here — we only ever care about movement (handled in
      // onMoveShouldSetPanResponder below), so taps pass through to buttons.
      onStartShouldSetPanResponder: () => false,

      // Fires repeatedly as the finger MOVES, before we own the gesture. Return
      // true to "claim" this drag as ours. We only claim a mostly-horizontal
      // drag (dx bigger than dy) that is either: starting from the left screen
      // edge while the sidebar is closed, OR any horizontal drag while it's
      // already open (so the user can swipe it back closed).
      onMoveShouldSetPanResponder: (_, gesture) => {
        const isHorizontal =
          Math.abs(gesture.dx) > Math.abs(gesture.dy) &&
          Math.abs(gesture.dx) > 2;
        if (!isHorizontal) return false;

        // Closed → only begin if the finger started near the left edge and is
        // moving to the right (dx > 0). This is the classic "edge swipe".
        if (
          !sidebarOpen.current &&
          gesture.moveX <= EDGE_WIDTH &&
          gesture.dx > 0
        ) {
          isSidebarGesture.current = true;
          return true;
        }
        // Open → claim any horizontal drag so the user can swipe to close.
        if (sidebarOpen.current) {
          isSidebarGesture.current = true;
          return true;
        }
        return false;
      },

      // Fires ONCE, the moment we win/claim the gesture. We "freeze" the current
      // sidebar position into an offset so that the upcoming finger movement is
      // added on top of wherever the sidebar already is (0 when closed,
      // SIDEBAR_WIDTH when open) instead of jumping to a new spot.
      onPanResponderGrant: () => {
        panX.current = sidebarOpen.current ? SIDEBAR_WIDTH : 0;
        if (isSidebarGesture.current) {
          sidebarAnim.setOffset(panX.current);
          sidebarAnim.setValue(0);
        }
      },

      // Fires on EVERY movement while we own the gesture. gesture.dx is how far
      // the finger has travelled since it went down. We convert that into a
      // sidebar position and clamp it between 0 (closed) and SIDEBAR_WIDTH
      // (open) so the sidebar can never be dragged past either end.
      onPanResponderMove: (_, gesture) => {
        if (!isSidebarGesture.current) return;
        let newX = gesture.dx;
        if (!sidebarOpen.current) newX = Math.max(0, newX); // closed: only allow rightward drag
        else newX = Math.min(0, newX); // open: only allow leftward drag
        const absolute = panX.current + newX;
        const clamped = Math.min(SIDEBAR_WIDTH, Math.max(0, absolute));
        sidebarAnim.setValue(clamped - panX.current);
      },

      // Fires when the finger LIFTS. We merge the offset back in, then decide
      // where to snap. Opening only needs a tiny drag past OPEN_THRESHOLD (or a
      // quick flick) — there is no "drag it halfway" rule, so a short pull will
      // NOT spring back closed. Adjust OPEN_THRESHOLD / CLOSE_THRESHOLD /
      // FLICK_VELOCITY at the top of this file to change how easy it feels.
      onPanResponderRelease: (_, gesture) => {
        if (!isSidebarGesture.current) return;
        sidebarAnim.flattenOffset();

        if (!sidebarOpen.current) {
          // Was closed → open on a small rightward drag or a rightward flick.
          const shouldOpen =
            gesture.dx > OPEN_THRESHOLD || gesture.vx > FLICK_VELOCITY;
          if (shouldOpen) openSidebar();
          else closeSidebar();
        } else {
          // Was open → close on a leftward drag or a leftward flick.
          const shouldClose =
            gesture.dx < -CLOSE_THRESHOLD || gesture.vx < -FLICK_VELOCITY;
          if (shouldClose) closeSidebar();
          else openSidebar();
        }
        isSidebarGesture.current = false;
      },
    }),
  ).current;

  const overlayOpacity = sidebarAnim.interpolate({
    inputRange: [0, SIDEBAR_WIDTH],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  // Sidebar "zoom in" — scales up and fades in only as it's revealed.
  const sidebarScale = sidebarAnim.interpolate({
    inputRange: [0, SIDEBAR_WIDTH],
    outputRange: [0.9, 1],
    extrapolate: "clamp",
  });
  const sidebarContentOpacity = sidebarAnim.interpolate({
    inputRange: [0, SIDEBAR_WIDTH * 0.4, SIDEBAR_WIDTH],
    outputRange: [0, 0.6, 1],
    extrapolate: "clamp",
  });

  // Home screen stops short of the full sidebar width so it rests a little further left when open.
  const mainTranslateX = sidebarAnim.interpolate({
    inputRange: [0, SIDEBAR_WIDTH],
    outputRange: [0, SIDEBAR_WIDTH - HOME_OPEN_SHIFT],
    extrapolate: "clamp",
  });

  const handleTopTabPress = (tab: TopTab) => {
    setActiveTopTab(tab);
    scrollViewRef.current?.scrollTo({
      x: tab === "home" ? 0 : SCREEN_WIDTH,
      animated: true,
    });
  };

  // const indicatorTranslateX = scrollX.interpolate({
  //   inputRange: [0, SCREEN_WIDTH],
  //   outputRange: [SCREEN_WIDTH * 0.2, SCREEN_WIDTH * 0.7],
  //   extrapolate: "clamp",
  // });

  const { theme } = useSettingsStore();
  const isDark = theme === "dark";
  const bg = isDark ? Colors.background : Colors.textWhite;
  const textColor = isDark ? Colors.textWhite : Colors.text;
  // const borderColor = isDark ? "rgba(255,255,255,0.07)" : "#E5E8EC";
  const sideBorderColor = isDark ? Colors.overlayLight : Colors.overlayLight;


  // Archived chats are deliberately out of sight; counting them keeps a badge
  // on the tab that nothing in the tab can clear.
  const totalUnread = conversations
    .filter((c) => !c.archived)
    .reduce((s, c) => s + (c.unread_count ?? c.unreadCount ?? 0), 0);

  const handleTabPress = (tab: Tab) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
  };

  const toggleSearch = () => {
    setFinderVisible(true);
  };

  // Measured, not guessed. The old constant was `topPadding + 130` while the
  // bar actually renders around `topPadding + 66`, so every home screen carried
  // ~64pt of dead space under the header — and any change to the bar's contents
  // silently made the gap wrong again. `onLayout` reports the real height, and
  // the initial value is only what is used for the single frame before the
  // first layout lands.
  const [measuredHeader, setMeasuredHeader] = useState(0);
  const HEADER_HEIGHT = measuredHeader || topPadding + 78;
  // Content padding so the last row clears the translucent bar it scrolls under.
  // The bar now floats clear of the screen edge, so content must clear the gap too.
  const BOTTOM_HEIGHT = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insets.bottom;

  const renderMainContent = () => {
    if (activeTab !== "home") {
      switch (activeTab) {
        case "game":
          return <GameTab />;
        case "profile":
          return <ProfileTab />;
        case "messages":
          return <MessagesTab />;
        case "notifications":
          return <NotificationsTab />;
        default:
          return null;
      }
    }

    return (
      <Animated.ScrollView
        ref={scrollViewRef as any}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
          setActiveTopTab(page === 0 ? "home" : "discover");
        }}
        keyboardShouldPersistTaps="handled"
      >

        <View style={[{ width: SCREEN_WIDTH, flex: 1 }, { backgroundColor: 'transparent' }]}>
          <MainTab insetTop={HEADER_HEIGHT} insetBottom={BOTTOM_HEIGHT} />
        </View>
        <View style={{ width: SCREEN_WIDTH, flex: 1 }}>
          <DiscoverTab scrollY={feedScrollY} />
        </View>
      </Animated.ScrollView>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* <StatusBar style={isDark ? 'light' : 'dark'}  animated/> */}

      {/* Static sidebar behind the main screen; zooms in as it's revealed */}
      <Animated.View
        style={[
          styles.sidebarBehind,
          {
            // backgroundColor: bg,
            opacity: sidebarContentOpacity,
            transform: [{ scale: sidebarScale }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <SidedBar />
      </Animated.View>

      {/* Main screen slides to the right to uncover the static sidebar */}
      <Animated.View
        style={[
          styles.mainSlider,
          { transform: [{ translateX: mainTranslateX }] },
          // { backgroundColor: bg }, {borderWidth: 1, borderColor: 'red'}
        ]}
        {...panResponder.panHandlers}
      >
        {/* The whole home screen (top bar + content + bottom bar) lives inside
            this card. It clips to rounded corners (overflow: hidden) so the
            animated border below hugs it neatly. */}
        <View style={[styles.homeCard, {}]}>
          {/* Dim overlay: covers the ENTIRE home screen (top bar, content AND
              bottom bar) while the sidebar is open. Tapping anywhere on it
              closes the sidebar. zIndex 200 keeps it above the top/bottom bars,
              which sit at zIndex 100 — otherwise those areas wouldn't dim or
              catch the close-tap. */}
          <Animated.View
            style={[styles.overlay, { opacity: overlayOpacity }, {backgroundColor:  isDark ? Colors.overlayLight : "rgba(205 205 205 / 0.46)"}, {}]}
            pointerEvents={isSidebarOpen ? "auto" : "none"}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar} />
          </Animated.View>

          {/* Rounded border that fades IN together with the overlay when the
              sidebar opens, and is fully invisible when closed. It's purely
              decorative and never intercepts touches (pointerEvents="none"), so
              the overlay underneath still receives the tap-to-close. Adjust its
              look via HOME_BORDER_WIDTH / HOME_BORDER_RADIUS up top. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.homeBorder,
              { opacity: overlayOpacity, borderColor: sideBorderColor },
              {}
            ]}
          />

          {/* Absolute Top Bar */}
          {activeTab === "home" && (
            <Animated.View
              style={[{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 100,
                borderTopLeftRadius: 45,
                overflow: "hidden",
                transform: [{ translateY: actualHeaderTranslateY }],
              },
                {  margin: 10, marginBottom: 0, paddingBottom: 10, borderRadius: 30 }
              ]}
            >
              <Glass
                  variant="clear"
                  style={StyleSheet.absoluteFill}
                  radius={30}
                  pointerEvents="none"
                  fallbackIntensity={12}
                  // fallbackTint={ios.scheme === "dark" ? "rgba(120,120,128,0.22)" : "rgba(120,120,128,0.12)"}
                  fallbackTint={ios.tertiarySystemFill}
                />
              <View
                onLayout={(e) => {
                  const h = Math.round(e.nativeEvent.layout.height);
                  // Guard the set: onLayout fires on every re-render and an
                  // unconditional setState here is an infinite loop.
                  setMeasuredHeader((prev) => (Math.abs(prev - h) > 1 ? h : prev));
                }}
                style={[
                  styles.header,
                  {
                    paddingTop: topPadding - 48,
                    paddingBottom: 0
                  },
                  // { borderWidth: .5, borderColor: ios.opaqueSeparator, margin: 10, marginTop: 5, marginBottom: 0, paddingBottom: 10, borderRadius: 30 }
                ]}
              >
                {/* The bar floats over scrolling content, so it takes the same glass as the tab bar rather than an opaque fill. */}
                {/* <Glass
                  variant="clear"
                  style={StyleSheet.absoluteFill}
                  radius={30}
                  pointerEvents="none"
                  fallbackIntensity={26}
                  fallbackTint={ios.scheme === "dark" ? "rgba(120,120,128,0.22)" : "rgba(120,120,128,0.12)"}
                  // fallbackTint={ios.secondarySystemBackground}
                /> */}
                <Pressable onPress={openSidebar} style={[styles.menuBtn, {alignItems:'center', justifyContent:'center'}]}>
                  <HugeiconsIcon
                    icon={Menu03Icon}
                    size={24}
                    color={textColor}
                    fill={textColor}
                  />
                </Pressable>
                <View style={styles.logoBtn}>
                  <NetworkStatus>
                    <Image
                      source={
                        isDark
                          ? require("../../assets/images/emilgo_logo_white.png")
                          : require("../../assets/images/emilgo_logo_black.png")
                      }
                      style={styles.photoImg}
                      resizeMode="contain"
                      width={25}
                    />
                  </NetworkStatus>
                </View>


                <View style={[{ alignItems:'center', justifyContent:'center'}]}>
                  <HeaderActions
                    // onBellPress={() => handleTabPress("notifications")}
                    onSearchPress={toggleSearch}
                    tint={textColor}
                    // style={{ marginRight: 8 }}
                  />
                </View>
              </View>

              {/* The same capsule segmented control the Profile screen uses:
                  a glass track with a glass thumb that springs between
                  segments, rather than a text row with an underline. */}
              <View style={[styles.topTabBar]}>
                <IOSSegmentedTabs
                  segments={TOP_TABS}
                  active={activeTopTab}
                  onChange={handleTopTabPress}
                  variant="capsule"
                  rounded="all"
                />
              </View>
            </Animated.View>
          )}

          <View style={[styles.content]}>{renderMainContent()}</View>

          {/* Floating Liquid Glass tab bar. Content scrolls under it, and it
              minimises rather than sliding away — the iOS 26 behaviour.

              It no longer has to hide for a chat. A conversation is its own
              route (`/direct-chat/[conversationId]`) pushed over this whole
              group, so it covers the bar by construction — the tab used to
              render a chat INLINE and then ask the layout to hide the bar,
              which is why there were two ways into a chat that behaved
              differently. */}
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 100,
              marginBottom: 30
            }}
            pointerEvents="box-none"
          >
            <IOSTabBar
              tabs={TABS.map((t) => {
                if (t.key === "messages") return { ...t, badge: totalUnread };
                if (t.key === "notifications") return { ...t, badge: unreadNotifications };
                if (t.key === "profile") {
                  return {
                    ...t,
                    render: ({ active }) => (
                      <View style={active ? styles.avatarActive : styles.avatarInactive}>
                        <Avatar
                          name={user?.full_name || "U"}
                          photoUri={user?.profile_photo}
                          size={26}
                        />
                      </View>
                    ),
                  };
                }
                return t;
              })}
              active={activeTab}
              onChange={(key) => handleTabPress(key as Tab)}
              minimized={activeTab === "home" && tabBarMinimized}
            />
          </View>

        </View>
      </Animated.View>

      <FindDriverModal
        visible={finderVisible}
        onClose={() => setFinderVisible(false)}
      />

      {isLoaded && shouldShow && <OnboardingOverlay onComplete={complete} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  sidebarBehind: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    zIndex: 0,
  },
  mainSlider: {
    flex: 1,
    width: SCREEN_WIDTH,
    zIndex: 1,
    // borderWidth: 2, borderColor: 'blue'
  },
  // The card that holds the entire home screen (top bar + content + bottom bar).
  // Rounded + clipped so the animated border below sits flush with its corners.
  homeCard: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: "100%",
    borderRadius: HOME_BORDER_RADIUS,
    overflow: "hidden",
  },
  overlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    // backgroundColor: "rgb(85 84 84 0.45)",
    borderRadius: HOME_BORDER_RADIUS,
    // Above the top/bottom bars (zIndex 100) so it dims and covers them too.
    zIndex: 200,
  },
  // Decorative outline that fades in with the overlay when the sidebar opens.
  homeBorder: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderWidth: HOME_BORDER_WIDTH,
    borderRadius: HOME_BORDER_RADIUS,
    zIndex: 201,
  },
  content: {
    flex: 1,
    height: "100%", 
  },
  header: {
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  // Relatively positioned so IOSBadge, which pins to its parent, lands on the
  // bell rather than on the row.
  bellBtn: { position: "relative", alignItems: "center", justifyContent: "center" },
  logoBtn: {
    width: 25,
    height: 25,
    marginVertical: 15,
    justifyContent: "center",
    alignItems: "center",
    flex: 1,
  },
  photoImg: { width: 50, height: 50, alignSelf: "center" },
  topTabBar: {
    // paddingTop: 12,
    paddingBottom: 0,
    paddingHorizontal: 10,
    marginTop: 10
  },
  tabBar: {
    position: "relative",
    overflow: "hidden",
  },
  tabBarBorder: {
    height: 1,
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  tabBarInner: {
    flexDirection: "row",
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
  },
  tabLabel: { fontSize: 10, letterSpacing: 0.2 },
  // Sized for the 26pt avatar in the capsule tab bar. The selected state already
  // reads from the highlight behind the item, so the ring stays subtle.
  avatarActive: {
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    padding: 1,
  },
  avatarInactive: {
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: "transparent",
    padding: 1,
  },
  unreadBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    backgroundColor: Colors.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  unreadBadgeText: {
    fontFamily: "Poppins_700Bold",
    fontSize: 9,
    color: "#fff",
  },
});
