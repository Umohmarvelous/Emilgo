// components/feed/FeedList.tsx
//
// The list every timeline is built on: For you, Following, a thread, a profile
// tab, a hashtag page, search results, bookmarks.
//
// It owns four things that are easy to get wrong once per screen:
//
//   1. **Ad interleaving.** Ads are spliced into the row array, not rendered by
//      the cell, so an ad never shifts when a post above it is deleted.
//   2. **Viewability.** One `viewabilityConfigCallbackPairs` drives inline video
//      playback, ad impressions and view counting. Creating that array inline
//      makes FlatList throw ("changing viewabilityConfigCallbackPairs on the
//      fly is not supported"), so it is built once in a ref.
//   3. **Scroll direction.** Exposed as a shared value so the owning screen can
//      slide its chrome away without this component knowing what chrome is.
//   4. **The three empty states.** Loading, failed, and genuinely empty are
//      different situations and a single "Nothing here" for all three is how a
//      feed hides its own outage.

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  type ViewToken,
} from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { FlatList } from "react-native";
import { useIOSTheme, IOSAppFont } from "@/components/ios/theme";
import { PostCard } from "./PostCard";
import { PromotedPost } from "./PromotedPost";
import { useFeedStore, AD_INTERVAL, AD_FIRST_SLOT, type TimelineKey } from "@/src/store/useFeedStore";
import { ExternalPostCard } from "./ExternalPostCard";
import type { ExternalPost } from "@/src/services/externalFeed";

/**
 * Cadence for ingested articles. Offset from AD_FIRST_SLOT (4) so a promoted
 * unit and a news card never land next to each other — two non-social rows in a
 * row is what makes a feed stop feeling like a feed.
 */
const EXTERNAL_FIRST_SLOT = 2;
const EXTERNAL_INTERVAL = 5;
import type { FeedPost, FeedAd } from "@/src/services/feed";

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<Row>);

type Row =
  | { kind: "post"; key: string; post: FeedPost; threadLine?: boolean }
  | { kind: "ad"; key: string; ad: FeedAd }
  | { kind: "external"; key: string; item: ExternalPost };

export interface FeedListProps {
  timelineKey: TimelineKey;
  /** Rendered above the first row and scrolls with it. */
  header?: React.ReactElement | null;
  /** Extra top padding so content starts below translucent chrome. */
  topInset?: number;
  bottomInset?: number;
  /** Detail mode for a thread: the first row is the post being viewed. */
  detailFirstRow?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  /** Written on every scroll frame; positive means the finger moved up. */
  scrollY?: SharedValue<number>;
  /**
   * Ingested outside articles to interleave. Only the main timelines pass any —
   * a thread or a profile tab is about one person and outside news would be
   * noise there.
   */
  external?: ExternalPost[];
  scrollDirection?: SharedValue<number>;
  onOpenPost?: (post: FeedPost) => void;
}

export function FeedList({
  timelineKey,
  header,
  topInset = 0,
  bottomInset = 0,
  detailFirstRow,
  emptyTitle = "No post yet",
  emptyBody = "Posts will show up here as people share them.",
  scrollY,
  external = [],
  scrollDirection,
  onOpenPost,
}: FeedListProps) {
  const t = useIOSTheme();
  const timeline = useFeedStore((s) => s.timelines[timelineKey]);
  const posts = useFeedStore((s) => s.posts);
  const load = useFeedStore((s) => s.load);
  const noteViewed = useFeedStore((s) => s.noteViewed);

  const [dismissedAds, setDismissedAds] = React.useState<string[]>([]);
  const [visibleIds, setVisibleIds] = React.useState<Set<string>>(() => new Set());

  const ids = timeline?.ids ?? [];
  const ads = timeline?.ads ?? [];

  React.useEffect(() => {
    if (!timeline) load(timelineKey, "initial");
  }, [timelineKey, timeline, load]);

  // Splice ads into fixed slots. Keying an ad by its position as well as its id
  // matters: the same creative can legitimately appear twice in a long scroll,
  // and two rows with one key silently drop the second.
  const rows = React.useMemo<Row[]>(() => {
    const live = ads.filter((a) => !dismissedAds.includes(a.id));
    const out: Row[] = [];
    let adCursor = 0;
    let extCursor = 0;

    ids.forEach((id, i) => {
      const post = posts[id];
      if (!post) return;
      out.push({
        kind: "post",
        key: id,
        post,
        // In a thread, every post except the last continues the column.
        threadLine: detailFirstRow ? i === 0 && ids.length > 1 : false,
      });

      const isSlot = i >= AD_FIRST_SLOT && (i - AD_FIRST_SLOT) % AD_INTERVAL === 0;
      if (isSlot && adCursor < live.length) {
        const ad = live[adCursor];
        out.push({ kind: "ad", key: `ad:${ad.id}:${i}`, ad });
        adCursor += 1;
      }

      // Outside articles on their own cadence, offset from the ad slots so a
      // reader never hits an advert and a news card back to back.
      const isNewsSlot =
        i >= EXTERNAL_FIRST_SLOT && (i - EXTERNAL_FIRST_SLOT) % EXTERNAL_INTERVAL === 0;
      if (isNewsSlot && extCursor < external.length) {
        const item = external[extCursor];
        out.push({ kind: "external", key: `ext:${item.id}:${i}`, item });
        extCursor += 1;
      }
    });

    // A brand-new account follows nobody and has posted nothing, so the feed
    // would be empty. The articles are real content and carry it until there
    // are posts — far better than an empty state on first launch.
    if (!ids.length && external.length) {
      external.forEach((item) => out.push({ kind: "external", key: `ext:${item.id}`, item }));
    }

    return out;
  }, [ids, posts, ads, dismissedAds, detailFirstRow, external]);

  // Built once. FlatList captures this on mount and warns if the identity
  // changes, so it must not be recreated when props do.
  const viewabilityPairs = React.useRef([
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 55, minimumViewTime: 200 },
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[] }) => {
        const keys = new Set<string>();
        const postIds: string[] = [];
        for (const v of viewableItems) {
          const row = v.item as Row;
          if (!row) continue;
          keys.add(row.key);
          if (row.kind === "post") postIds.push(row.post.id);
        }
        setVisibleIds(keys);
        if (postIds.length) noteViewed(postIds);
      },
    },
  ]).current;

  const lastY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y;
      if (scrollY) scrollY.value = y;
      if (scrollDirection) {
        const dy = y - lastY.value;
        // A 4px deadband: without it, the rubber-band settle at the top of the
        // list flickers the chrome open and shut.
        if (Math.abs(dy) > 4) scrollDirection.value = dy > 0 ? 1 : -1;
        if (y <= topInset) scrollDirection.value = -1;
      }
      lastY.value = y;
    },
  });

  const renderItem = React.useCallback(
    ({ item, index }: { item: Row; index: number }) => {
      if (item.kind === "external") {
        return <ExternalPostCard post={item.item} />;
      }
      if (item.kind === "ad") {
        return (
          <PromotedPost
            ad={item.ad}
            visible={visibleIds.has(item.key)}
            onDismiss={(id) => setDismissedAds((d) => [...d, id])}
          />
        );
      }
      return (
        <PostCard
          post={item.post}
          active={visibleIds.has(item.key)}
          detail={detailFirstRow && index === 0}
          threadLine={item.threadLine}
          onOpen={onOpenPost}
        />
      );
    },
    [visibleIds, detailFirstRow, onOpenPost],
  );

  const loading = timeline?.loading ?? true;
  const error = timeline?.error ?? null;

  return (
    <AnimatedFlatList
      data={rows}
      keyExtractor={(r) => r.key}
      renderItem={renderItem}
      onScroll={onScroll}
      scrollEventThrottle={16}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset + 24 }}
      showsVerticalScrollIndicator={false}
      viewabilityConfigCallbackPairs={viewabilityPairs}
      refreshControl={
        <RefreshControl
          refreshing={timeline?.refreshing ?? false}
          onRefresh={() => load(timelineKey, "refresh")}
          tintColor={t.tint}
          colors={[t.tint]}
          progressViewOffset={topInset}
        />
      }
      onEndReached={() => load(timelineKey, "more")}
      onEndReachedThreshold={0.6}
      // A tall window keeps video cells mounted just off screen so playback
      // resumes instantly, without keeping the whole timeline in memory.
      windowSize={9}
      maxToRenderPerBatch={6}
      initialNumToRender={7}
      removeClippedSubviews
      ListFooterComponent={
        timeline?.loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={t.tint} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        loading ? (
          <View style={[styles.empty, { paddingTop: topInset + 60 }]}>
            <ActivityIndicator color={t.tint} />
          </View>
        ) : error ? (
          <View style={[styles.empty, { paddingTop: topInset + 60 }]}>
            {/* <Text style={[styles.emptyTitle, { color: t.label }]}>Could not load</Text> */}
            <Text style={[styles.emptyBody, { color: t.secondaryLabel }]}>{error}</Text>
            <Pressable
              onPress={() => load(timelineKey, "refresh")}
              style={[styles.retry, { borderColor: t.tint }]}
            >
              <Text style={[styles.retryText, { color: t.tint }]}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.empty, { paddingTop: topInset + 30 }]}>
            <Text style={[styles.emptyTitle, { color: t.label }]}>{emptyTitle}</Text>
            <Text style={[styles.emptyBody, { color: t.secondaryLabel }]}>{emptyBody}</Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  footer: { paddingVertical: 24, alignItems: "center" },
  empty: { alignItems: "center", paddingHorizontal: 40, gap: 6 },
  emptyTitle: { ...IOSAppFont.headline, textAlign: "center" },
  emptyBody: { ...IOSAppFont.footnote, textAlign: "center", lineHeight: 19 },
  retry: {
    marginTop: 12,
    // borderWidth: 1,
    // borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  retryText: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },
});
