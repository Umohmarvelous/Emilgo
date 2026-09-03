// app/follows/[userId].tsx
//
// Followers and following for one account, as two tabs over one list.
//
// Opened from the counts on a profile, with `tab` deciding which side you land
// on — tapping "128 followers" should not put you on the following list and
// make you find your way back.
//
// ── Paging ───────────────────────────────────────────────────────────────────
// The RPCs take limit/offset and cap at 100. A driver with thousands of regulars
// is the case that matters, so this pages rather than fetching everything: a
// short page on arrival, more as you reach the end. `hasMore` is inferred from a
// full page coming back, which costs nothing — a count query would be a second
// round trip to learn something the next scroll answers anyway.

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Animated from "react-native-reanimated";
import { SymbolView } from "expo-symbols";

import {
  IOSScreen,
  IOSSegmentedTabs,
  useCollapsibleScroll,
  useIOSTheme,
  IOSAppFont,
  type IOSSegment,
} from "@/components/ios";
import Avatar from "@/components/Avatar";
import FollowButton from "@/components/FollowButton";
import { haptics } from "@/src/utils/haptics";
import {
  useFollowsStore,
  FOLLOW_PAGE,
  type FollowList,
  type FollowPerson,
} from "@/src/store/useFollowsStore";

const TABS: IOSSegment<FollowList>[] = [
  { key: "followers", label: "Followers" },
  { key: "following", label: "Following" },
];

export default function FollowsScreen() {
  const params = useLocalSearchParams<{ userId: string; tab?: FollowList; name?: string }>();
  const userId = params.userId;

  const theme = useIOSTheme();
  const scroll = useCollapsibleScroll();
  const listPeople = useFollowsStore((s) => s.listPeople);
  const stats = useFollowsStore((s) => s.stats[userId]);
  const loadStats = useFollowsStore((s) => s.loadStats);

  const [tab, setTab] = useState<FollowList>(params.tab === "following" ? "following" : "followers");
  const [people, setPeople] = useState<FollowPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (which: FollowList) => {
      setLoading(true);
      const page = await listPeople(userId, which, 0);
      setPeople(page);
      setHasMore(page.length === FOLLOW_PAGE);
      setLoading(false);
    },
    [userId, listPeople],
  );

  useEffect(() => {
    if (!userId) return;
    void load(tab);
  }, [userId, tab, load]);

  useEffect(() => {
    if (userId && !stats) void loadStats(userId);
  }, [userId, stats, loadStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(tab), loadStats(userId)]);
    setRefreshing(false);
  }, [load, tab, loadStats, userId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    const page = await listPeople(userId, tab, people.length);
    setPeople((prev) => [...prev, ...page]);
    setHasMore(page.length === FOLLOW_PAGE);
    setLoadingMore(false);
  }, [loadingMore, hasMore, loading, listPeople, userId, tab, people.length]);

  const openProfile = useCallback((person: FollowPerson) => {
    haptics.tap();
    // Drivers have a public profile worth opening; passengers don't have one yet.
    if (person.driver_id) {
      router.push({
        pathname: "/(passenger)/verify-driver",
        params: { driverId: person.driver_id },
      } as never);
    }
  }, []);

  // Counts sit on the segments themselves, so switching tabs never hides the
  // number you tapped to get here.
  const segments: IOSSegment<FollowList>[] = TABS.map((t) => ({
    ...t,
    badge: t.key === "followers" ? stats?.followers : stats?.following,
  }));

  return (
    <IOSScreen
      // title={params.name || "Connections"}
      title={""}
      subtitle={tab === "followers" ? "People who follow this accountsssssssssssss" : "Accounts this profile follows"}
      back
      scrollable={false}
      scroll={scroll}
    >
      <Animated.FlatList
        data={people}
        keyExtractor={(item: FollowPerson) => item.id}
        showsVerticalScrollIndicator={false}
        {...scroll.scrollProps}
        contentContainerStyle={[styles.list, scroll.scrollProps.contentContainerStyle]}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            progressViewOffset={scroll.contentInset}
            tintColor={theme.tint}
          />
        }
        ListHeaderComponent={
          <View style={styles.strip}>
            <IOSSegmentedTabs
              segments={segments}
              active={tab}
              onChange={setTab}
              variant="capsule"
              rounded="all"
            />
          </View>
        }
        renderItem={({ item }: { item: FollowPerson }) => (
          <Pressable
            onPress={() => openProfile(item)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? theme.systemFill : "transparent" },
            ]}
            accessibilityRole="button"
            accessibilityLabel={item.full_name ?? "User"}
          >
            <Avatar name={item.full_name || "User"} photoUri={item.profile_photo} size={44} />

            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[IOSAppFont.label, { color: theme.label }]}>
                {item.full_name || "Unnamed"}
              </Text>
              <Text numberOfLines={1} style={[IOSAppFont.description, { color: theme.secondaryLabel }]}>
                {item.username ? `@${item.username}` : item.driver_id || item.role}
                {item.avg_rating ? ` · ${Number(item.avg_rating).toFixed(1)}★` : ""}
              </Text>
            </View>

            <FollowButton userId={item.id} initialFollowing={item.is_following} size="small" />
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.spinner} color={theme.tint} />
          ) : (
            <View style={styles.empty}>
              <SymbolView
                name={tab === "followers" ? "person.2" : "person.badge.plus"}
                size={46}
                tintColor={theme.tertiaryLabel}
                fallback={null}
              />
              <Text style={[IOSAppFont.label, { color: theme.label }]}>
                {tab === "followers" ? "No followers yet" : "Not following anyone yet"}
              </Text>
              <Text style={[IOSAppFont.description, styles.centre, { color: theme.secondaryLabel }]}>
                {tab === "followers"
                  ? "Regulars who follow this account will appear here."
                  : "Follow a driver to see when they're running your route."}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.spinner} color={theme.tint} /> : null
        }
      />
    </IOSScreen>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16 },
  strip: { paddingBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderRadius: 16,
    minHeight: 44,
  },
  rowText: { flex: 1, gap: 1 },
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 30, gap: 10 },
  centre: { textAlign: "center" },
  spinner: { marginTop: 24 },
});
