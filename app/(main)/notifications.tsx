// app/(main)/notifications.tsx
//
// The Notification tab — what took the Settings tab's slot.
//
// Scope, per the product decision: app notifications, messages from
// drivers/passengers, and sync alerts. Trip and transaction notices
// deliberately do NOT live here — they belong to History, where a user already
// goes to reconstruct what happened on a journey. Splitting them keeps this
// list about things that need attention now, rather than a receipt archive.
//
// Grouping follows the iOS convention: relative day buckets (Today /
// Yesterday / This Week / Earlier), newest first, unread carrying a leading
// dot rather than a different background — a filled row reads as "selected" on
// iOS, not "unread".
//
// ── Records, not a projection ────────────────────────────────────────────────
// The list comes from `useNotificationsStore`, which persists real rows. It used
// to be computed on the fly from conversations with unread messages, which made
// swipe-to-delete impossible: deleting recomputed the item straight back on the
// next render. The store folds conversations in through `ingestConversations`
// and remembers dismissals, so a swipe sticks.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, RefreshControl, SectionList } from "react-native";
import { router } from "expo-router";
import Animated from "react-native-reanimated";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

import {
  Glass,
  IOSScreen,
  SwipeableRow,
  iosActionSheet,
  useCollapsibleScroll,
  useIOSTheme,
  IOSAppFont,
  type SwipeableRowHandle,
  type IOSPalette,
} from "@/components/ios";
import Avatar from "@/components/Avatar";
import {
  ScreenSearch,
  ScreenSearchBar,
  useScreenSearch,
  type SearchEntry,
} from "@/components/ScreenSearch";
import { listNotifications, markNotificationsRead } from "@/src/services/feed";
import { useMessagesStore } from "@/src/store/useMessagesStore";
import {
  useNotifications,
  useNotificationsStore,
  type AppNotification,
  type NotificationKind,
} from "@/src/store/useNotificationsStore";
import { triggerSyncNow } from "@/src/services/sync";
import { haptics } from "@/src/utils/haptics";
import { Colors } from "@/constants/colors";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { MoreHorizontalCircleIcon } from "@hugeicons/core-free-icons";

const KIND_GLYPH: Record<NotificationKind, SymbolViewProps["name"]> = {
  message: "bubble.left.fill",
  sync: "arrow.triangle.2.circlepath",
  system: "bell.fill",
  social: "person.2.fill",
  trip: "car.fill",
  payment: "creditcard.fill",
};

// Reanimated re-exports FlatList and ScrollView but not SectionList, so the
// animated variant has to be created here for the scroll handler to drive the
// collapsing header off the UI thread.
const AnimatedSectionList = Animated.createAnimatedComponent(
  SectionList as new () => SectionList<AppNotification, { title: string }>,
);

/**
 * Search filters. `all` first so it is the default chip, then the two axes a
 * long inbox actually gets narrowed on: state, and whether it is a person
 * writing to you or the app telling you something.
 */
type NotifFilter = "all" | "unread" | "read" | "messages" | "activity";

const NOTIF_FILTERS = [
  { key: "all" as const, label: "All" },
  { key: "unread" as const, label: "Unread" },
  { key: "read" as const, label: "Read" },
  { key: "messages" as const, label: "Messages" },
  { key: "activity" as const, label: "Activity" },
];

// ─── Grouping ────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/** iOS-style relative buckets, newest first. */
function groupByRecency(items: AppNotification[]) {
  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);

  const buckets: Record<string, AppNotification[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Earlier: [],
  };

  for (const n of items) {
    const t = new Date(n.createdAt).getTime();
    if (t >= startOfToday) buckets.Today.push(n);
    else if (t >= startOfToday - DAY) buckets.Yesterday.push(n);
    else if (now - t < 7 * DAY) buckets["This Week"].push(n);
    else buckets.Earlier.push(n);
  }

  return Object.entries(buckets)
    .filter(([, data]) => data.length > 0)
    .map(([title, data]) => ({
      title,
      data: data.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    }));
}

function relativeTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function NotificationRow({
  item,
  ios,
  onPress,
  onDelete,
  onToggleRead,
  registerRow,
}: {
  item: AppNotification;
  ios: IOSPalette;
  onPress: () => void;
  onDelete: () => void;
  onToggleRead: () => void;
  registerRow: (id: string, handle: SwipeableRowHandle | null) => void;
}) {
  return (
    <SwipeableRow
      ref={(h) => registerRow(item.id, h)}
      // Destructive last: it sits against the screen edge, which is where the
      // full swipe grows from.
      actions={[
        {
          key: "read",
          label: item.read ? "Unread" : "Read",
          symbol: item.read ? "envelope.badge" : "envelope.open",
          color: ios.systemGray,
          onPress: onToggleRead,
        },
        {
          key: "delete",
          label: "Delete",
          symbol: "trash",
          color: ios.systemRed,
          destructive: true,
          onPress: onDelete,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          // The row slides over the action panel, so it needs its own opaque
          // fill — a transparent row would show the red panel through it.
          { backgroundColor: pressed ? ios.systemFill : ios.systemGroupedBackground },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${item.body}`}
      >
        {/* Unread marker. A dot, not a tinted row — a filled row reads as
            "selected" on iOS, which is a different meaning. */}
        <View style={styles.unreadSlot}>
          {!item.read && <View style={[styles.unreadDot, { backgroundColor: ios.tint }]} />}
        </View>

        {/* People-shaped notifications show the person, not a glyph. */}
        {item.kind === "message" ? (
          <Avatar name={item.title} photoUri={item.photoUri} size={34} />
        ) : (
          <View style={styles.iconTile}>
            <Glass
              variant="clear"
              radius={10}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              fallbackIntensity={25}
              fallbackTint={ios.tertiarySystemFill}
            />
            <SymbolView
              name={KIND_GLYPH[item.kind]}
              size={17}
              tintColor={ios.label}
              fallback={null}
            />
          </View>
        )}

        <View style={styles.rowText}>
          {/* Title and time share a line, so the time stays beside the thing it
              dates. It used to be a third column with `alignItems: center`, so a
              two-line body pushed the timestamp down to the middle of the row
              where it read as belonging to neither line. */}
          <View style={styles.rowTop}>
            <Text
              numberOfLines={1}
              style={[
                IOSAppFont.label,
                { color: ios.label, flex: 1 },
                !item.read && styles.titleUnread,
              ]}
            >
              {item.title}
            </Text>
            <Text
              style={[
                IOSAppFont.description,
                { color: item.read ? ios.tertiaryLabel : ios.tint },
              ]}
            >
              {relativeTime(item.createdAt)}
            </Text>
          </View>
          <Text numberOfLines={2} style={[IOSAppFont.description, { color: ios.secondaryLabel }]}>
            {item.body}
          </Text>
        </View>
      </Pressable>
    </SwipeableRow>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const ios = useIOSTheme();
  const scroll = useCollapsibleScroll({ tabBar: true });
  const [refreshing, setRefreshing] = useState(false);

  const conversations = useMessagesStore((s) => s.conversations);
  const notifications = useNotifications();

  const ingestConversations = useNotificationsStore((s) => s.ingestConversations);
  const ingestSocial = useNotificationsStore((s) => s.ingestSocial);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markUnread = useNotificationsStore((s) => s.markUnread);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const remove = useNotificationsStore((s) => s.remove);
  const clearAll = useNotificationsStore((s) => s.clearAll);

  // Fold unread conversations into the inbox whenever they change. Idempotent,
  // and it honours dismissals, so this can run as often as it likes.
  useEffect(() => {
    ingestConversations(conversations ?? []);
  }, [conversations, ingestConversations]);

  // Server-side social activity — likes, replies, follows — lands in the same
  // inbox as messages. One list, one badge: a user who sees "3" on the bell
  // should find three things here, not three messages plus some likes on a
  // different screen.
  const pullSocial = useCallback(async () => {
    const rows = await listNotifications(50, 0);
    ingestSocial(rows);
  }, [ingestSocial]);

  useEffect(() => {
    pullSocial();
  }, [pullSocial]);

  const sections = useMemo(() => groupByRecency(notifications), [notifications]);
  const unread = notifications.reduce((n, i) => n + (i.read ? 0 : 1), 0);

  // ── Search ────────────────────────────────────────────────────────────────
  // Real content search, over the rows actually on this screen. The filter
  // chips narrow by state and kind, which is what a long inbox needs more than
  // a query does.
  const searchEntries = useMemo<SearchEntry<NotifFilter>[]>(
    () =>
      notifications.map((n) => ({
        id: n.id,
        title: n.title,
        subtitle: n.body,
        symbol: KIND_GLYPH[n.kind],
        group: n.read ? "Read" : "Unread",
        hint: relativeTime(n.createdAt),
        keywords: [n.kind, relativeTime(n.createdAt)],
        filters: [
          "all",
          n.read ? ("read" as const) : ("unread" as const),
          n.kind === "message" ? ("messages" as const) : ("activity" as const),
        ],
        onPress: () => {
          markRead(n.id);
          if (n.route) router.push(n.route as never);
        },
      })),
    [notifications, markRead],
  );

  const search = useScreenSearch<NotifFilter>({
    scope: "notifications",
    entries: searchEntries,
    filters: NOTIF_FILTERS,
  });

  // Only one row stays open at a time, as in Mail: opening a second closes the
  // first, so there is never a hidden action panel off-screen.
  const rows = useRef(new Map<string, SwipeableRowHandle | null>());
  const registerRow = useCallback((id: string, handle: SwipeableRowHandle | null) => {
    if (handle) rows.current.set(id, handle);
    else rows.current.delete(id);
  }, []);
  const closeAllRows = useCallback(() => {
    for (const handle of rows.current.values()) handle?.close();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([triggerSyncNow(), pullSocial()]);
    setRefreshing(false);
  }, [pullSocial]);

  const open = useCallback(
    (item: AppNotification) => {
      haptics.tap();
      closeAllRows();
      markRead(item.id);
      if (item.route) router.push(item.route as never);
    },
    [closeAllRows, markRead],
  );

  const showActions = useCallback(() => {
    haptics.tap();
    iosActionSheet(
      "Notifications",
      undefined,
      [
        {
          text: unread > 0 ? `Mark all as read (${unread})` : "Mark all as read",
          onPress: () => {
            haptics.success();
            markAllRead();
            // The server owns read state for social rows, so clearing locally
            // alone would leave the badge full again on the next pull.
            markNotificationsRead().catch(() => undefined);
          },
        },
        {
          text: "Clear all",
          style: "destructive",
          onPress: () => {
            haptics.success();
            clearAll();
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }, [unread, markAllRead, clearAll]);

  return (
    <IOSScreen
      title="Notifications"
      subtitle={unread > 0 ? `${unread} unread` : undefined}
      scrollable={false}
      scroll={scroll}
      right={
        notifications.length > 0 ? (
          <Pressable
            onPress={showActions}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Notification options"
          >
            <HugeiconsIcon icon={MoreHorizontalCircleIcon} size={20} color={ios.label} />
          </Pressable>
        ) : undefined
      }
    >

      {/* The overlay is a modal, so it can live anywhere in the tree. The BAR
          cannot: as a sibling of the list it rendered at frame y=0, which on a
          translucent-header screen is underneath the header. It belongs in the
          list header, where the list's own top inset carries it clear. */}
      <ScreenSearch
        search={search}
        placeholder="Search notifications"
        emptyHint="Search by who sent it, what it says, or how long ago."
      />

      <AnimatedSectionList
        ListHeaderComponent={
          <ScreenSearchBar
            search={search}
            placeholder="Search notifications"
            style={styles.searchBar}
          />
        }
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationRow
            item={item}
            ios={ios}
            registerRow={registerRow}
            onPress={() => open(item)}
            onDelete={() => remove(item.id)}
            onToggleRead={() => (item.read ? markUnread(item.id) : markRead(item.id))}
          />
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Glass
              variant="regular"
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              fallbackIntensity={70}
              fallbackTint={ios.systemGroupedBackground}
            />
            <Text style={[IOSAppFont.sectionTitle, { color: ios.secondaryLabel }]}>
              {section.title.toUpperCase()}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={closeAllRows}
        {...scroll.scrollProps}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            progressViewOffset={scroll.refreshOffset}
            tintColor={ios.tint}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <SymbolView name="bell.slash" size={54} tintColor={ios.tertiaryLabel} fallback={null} />
            <Text style={[IOSAppFont.label, { color: ios.secondaryLabel }]}>
              No Recent Notification
            </Text>
          </View>
        }
      />
    </IOSScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    // Top, not centre: the avatar should sit beside the title, not float
    // halfway down beside a two-line body.
    alignItems: "flex-start",
    gap: 12,
    paddingLeft: 0,
    paddingRight: 20,
    paddingVertical: 14,
    minHeight: 44,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleUnread: { fontFamily: "Poppins_600SemiBold" },
  // Sits above the list, inside the screen's own padding. It does not scroll
  // away: search is how you find something in a long inbox, and hiding it
  // behind a scroll-to-top means scrolling the thing you cannot navigate.
  searchBar: { paddingHorizontal: 13, paddingBottom: 12 },
  unreadSlot: { width: 22, alignItems: "center" },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 7,
    overflow: "hidden",
  },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: 44, gap: 15 },
});
