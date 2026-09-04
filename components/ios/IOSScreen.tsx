// components/ios/IOSScreen.tsx
//
// The standard iOS screen scaffold: semantic background, a collapsing
// large-title nav bar with a frosted backdrop, a back button that matches the
// system chevron, and scroll plumbing that already accounts for the translucent
// tab bar.
//
// This exists so migrating an existing screen is a wrap rather than a rewrite:
//
//   export default function SavedRoutes() {
//     return (
//       <IOSScreen title="Saved Routes" back>
//         <IOSListSection>…</IOSListSection>
//       </IOSScreen>
//     );
//   }
//
// Screens that own their own scrolling (FlatList, MapView, a pager) pass
// `scrollable={false}` and render whatever they like; they still get the
// background and the header.

import React from "react";
import {
  View,
  Pressable,
  Platform,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
  type RefreshControlProps,
  Text,
} from "react-native";
import Animated from "react-native-reanimated";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";

import { useIOSTheme } from "./theme";
import {
  CollapsibleHeader,
  useCollapsibleScroll,
  type CollapsibleScroll,
} from "./CollapsibleHeader";
import { useTabBarInset } from "./IOSTabBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";


export interface IOSScreenProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;

  /** Show the system back chevron. */
  back?: boolean;
  /** Called instead of router.back() when the chevron is tapped. */
  onBack?: () => void;
  /** Right-hand nav bar slot. */
  right?: React.ReactNode;

  /**
   * Wrap children in a scroll view (default). Turn off for screens that own
   * their scrolling — a FlatList, a map, a pager.
   */
  scrollable?: boolean;
  /**
   * Grouped background (#F2F2F7 light) for list-style screens, which is the
   * default. `false` gives the plain systemBackground used by content screens.
   */
  grouped?: boolean;
  /** Leave room for the translucent tab bar. On for screens inside the shell. */
  tabBarInset?: boolean;

  /**
   * For `scrollable={false}` screens that own a FlatList/SectionList: pass the
   * scroll object from `useCollapsibleScroll()` and wire its `onScroll` to your
   * list. Without it the header renders STATIC rather than collapsible, because
   * a collapsing header nothing ever scrolls is just a large title that lies
   * about being interactive.
   */
  scroll?: CollapsibleScroll;

  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}

function BackChevron({ onPress }: { onPress: () => void }) {
  const theme = useIOSTheme();
  return (
    <Pressable style={{flexDirection: 'row', alignItems:'center', gap:7}} onPress={onPress} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
      {/* <SymbolView
        name="chevron.backward"
        size={19}
        tintColor={theme.label}
        resizeMode="scaleAspectFit"
        fallback={<View style={{ width: 22, height: 22 }} />}
      /> */}
      <HugeiconsIcon icon={ArrowLeft01Icon} size={24} color={theme.label} strokeWidth={2} />
      <Text style={[{fontFamily: "Poppins_600SemiBold", fontSize: 15}, { color: theme.label }]}>Back</Text>
    </Pressable>
  );
}

export function IOSScreen({
  title,
  subtitle,
  children,
  back,
  onBack,
  right,
  scrollable = true,
  grouped = true,
  tabBarInset = false,
  contentContainerStyle,
  refreshControl,
  scroll: externalScroll,
}: IOSScreenProps) {
  const theme = useIOSTheme();
  const internalScroll = useCollapsibleScroll();
  const bottomInset = useTabBarInset();

  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const scroll = externalScroll ?? internalScroll;
  // Collapse only when something genuinely drives the offset: our own
  // ScrollView, or a list the caller wired up.
  const collapsible = scrollable || !!externalScroll;

  const background = grouped ? theme.systemBackground : theme.systemBackground;

  // A RefreshControl draws its spinner at y=0 of the scrollable, which on every
  // screen in this app is UNDERNEATH the translucent header. Callers kept
  // forgetting `progressViewOffset`, so the pull worked and looked broken.
  // Injecting it here means no screen has to remember — and an explicit offset
  // passed by a caller still wins.
  const refreshControlWithOffset = React.useMemo(
    () =>
      refreshControl
        ? React.cloneElement(refreshControl, {
            progressViewOffset: refreshControl.props.progressViewOffset ?? scroll.refreshOffset,
          })
        : undefined,
    [refreshControl, scroll.refreshOffset],
  );

  return (
    <View style={[styles.root, { backgroundColor: background },
      // { paddingTop: topPadding + 10 }
    ]}>
      {/* Status bar text flips with the palette, never hard-coded. */}
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} animated />

      <CollapsibleHeader
        title={title}
        subtitle={subtitle}
        collapsible={collapsible}
        scrollY={scroll.value}
        left={back ? <BackChevron onPress={onBack ?? (() => router.back())} /> : undefined}
        right={right}
      />

      {scrollable ? (
        <Animated.ScrollView
          onScroll={scroll.onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControlWithOffset}
          // Large-title screens keep the indicator clear of the header.
          scrollIndicatorInsets={{ top: scroll.contentInset }}
          contentContainerStyle={[
            {
              // contentTop, not contentInset: the gap is what stops the first
              // card sitting flush against the title.
              paddingTop: scroll.contentTop,
              paddingBottom: (tabBarInset ? bottomInset : 0) + 32,
              // The page owns its gutter; sections own their vertical rhythm.
              paddingHorizontal: PAGE_INSET,
            },
            contentContainerStyle,
          ]}
        >
          {children}
        </Animated.ScrollView>
      ) : (
        // A screen that brought its own `scroll` also owns a scrollable, and
        // that scrollable already carries the header inset as a CONTENT inset
        // (via `scroll.scrollProps`). Padding the frame as well would inset
        // twice — content starting a whole header-height too low — and, worse,
        // would stop anything from passing under the bar, leaving the glass
        // with nothing to sample and rendering it flat.
        //
        // Only a static screen, where nothing scrolls under the header at all,
        // needs the frame padding.
        <View style={[styles.body, externalScroll ? null : { paddingTop: scroll.contentTop }]}>
          {children}
        </View>
      )}
    </View>
  );
}

/** Page gutter, matching the app's original screens. */
const PAGE_INSET = 26;

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});

export default IOSScreen;
