/**
 * app/(main)/discover.tsx — the "For You" tab.
 *
 * ── What changed, and why ───────────────────────────────────────────────────
 * This screen used to render posts pulled live from Reddit. That was fine as a
 * way to see the layout working, but it is other people's content on a product
 * shipping to real users: Emilgo cannot moderate it, cannot delete it, and does
 * not own it. Every post here now comes from Emilgo's own `posts` table, written
 * by Emilgo's own users, governed by the RLS and block rules in
 * supabase/migrations/migration_social_feed.sql.
 *
 * The engagement-credits system that lived here is NOT gone — it moved into
 * `useFeedStore`, which is the single point every like, reply and share now
 * passes through, so credits are awarded once no matter which screen the action
 * started on. See the `award()` helper there.
 *
 * ── Structure ───────────────────────────────────────────────────────────────
 * Two timelines behind a segmented control: For you (ranked) and Following
 * (strictly chronological). Both render through `FeedList`, which owns ad
 * interleaving, view counting and inline-video gating.
 *
 * ── Chrome ──────────────────────────────────────────────────────────────────
 * `scrollY` is handed down from `app/(main)/_layout.tsx`, which drives the
 * header and tab bar out of the way on the way down and back on the way up.
 * That behaviour is deliberately scoped to this screen: the parent multiplies
 * the translation by how far the horizontal pager has moved onto this pane, so
 * the Home pane's chrome never moves.
 */

import React from "react";
import { View, Text, StyleSheet, Pressable, Platform, Animated as RNAnimated } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSharedValue, useAnimatedReaction, runOnJS } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { FireIcon, UserAdd01Icon, Plus } from "@hugeicons/core-free-icons";
import { Glass, IOSTitleDropdown, useIOSTheme, type IOSTitleDropdownOption } from "@/components/ios";
import { IOSAppFont } from "@/components/ios/theme";
import { FeedList } from "@/components/feed";
import { TAB_BAR_HEIGHT, TAB_BAR_BOTTOM_GAP } from "@/components/ios";
import Avatar from "@/components/Avatar";
import { useAuthStore } from "@/src/store/useStore";
import { useFeedStore } from "@/src/store/useFeedStore";
import {
  listExternalPosts,
  refreshExternalFeed,
  type ExternalPost,
} from "@/src/services/externalFeed";
import { useFollowsStore } from "@/src/store/useFollowsStore";
import {
  trendingHashtags,
  suggestedAccounts,
  type TrendingTag,
  type SuggestedAccount,
} from "@/src/services/feed";

type Lane = "for-you" | "following";

const LANES: IOSTitleDropdownOption<Lane>[] = [
  { key: "for-you", label: "For you", detail: "Ranked across Emilgo", symbol: "sparkles" },
  { key: "following", label: "Following", detail: "Only people you follow", symbol: "person.2.fill" },
];

// ─── Trending rail ───────────────────────────────────────────────────────────

function TrendingRail({ tags }: { tags: TrendingTag[] }) {
  const t = useIOSTheme();
  const router = useRouter();
  if (!tags.length) return null;

  return (
    <View style={[styles.railWrap, { borderBottomColor: t.separator }]}>
      <View style={styles.railHead}>
        <HugeiconsIcon icon={FireIcon} size={15} color={t.systemOrange} strokeWidth={2} />
        <Text style={[styles.railTitle, { color: t.label }]}>Trending in transport</Text>
      </View>
      <View style={styles.railTags}>
        {tags.slice(0, 6).map((tag) => (
          <Pressable
            key={tag.tag}
            onPress={() => router.push(`/hashtag/${encodeURIComponent(tag.tag)}` as any)}
            style={[styles.tagChip, { backgroundColor: t.tertiarySystemFill }]}
          >
            <Text style={[styles.tagChipText, { color: t.tint }]}>#{tag.tag}</Text>
            <Text style={[styles.tagChipCount, { color: t.tertiaryLabel }]}>{tag.posts}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Who to follow ───────────────────────────────────────────────────────────

function SuggestionsCard({
  people,
  onFollowed,
}: {
  people: SuggestedAccount[];
  onFollowed: (id: string) => void;
}) {
  const t = useIOSTheme();
  const router = useRouter();
  const toggleFollow = useFollowsStore((s) => s.toggleFollow);
  const applyFollow = useFeedStore((s) => s.applyFollow);
  const [done, setDone] = React.useState<string[]>([]);

  if (!people.length) return null;

  return (
    <View style={[styles.railWrap, { borderBottomColor: t.separator }]}>
      <View style={styles.railHead}>
        <HugeiconsIcon icon={UserAdd01Icon} size={15} color={t.tint} strokeWidth={2} />
        <Text style={[styles.railTitle, { color: t.label }]}>People to follow</Text>
      </View>

      {people.slice(0, 3).map((p) => {
        const following = done.includes(p.id);
        return (
          <Pressable
            key={p.id}
            onPress={() => router.push(`/follows/${p.id}` as any)}
            style={styles.person}
          >
            <Avatar name={p.full_name || p.username || "User"} photoUri={p.profile_photo} size={38} />
            <View style={styles.personText}>
              <Text style={[styles.personName, { color: t.label }]} numberOfLines={1}>
                {p.full_name || p.username}
              </Text>
              <Text style={[styles.personMeta, { color: t.tertiaryLabel }]} numberOfLines={1}>
                {p.username ? `@${p.username}` : p.role}
                {p.follower_count > 0 ? ` · ${p.follower_count} followers` : ""}
              </Text>
            </View>
            <Pressable
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const ok = await toggleFollow(p.id);
                if (!ok) return;
                setDone((d) => (d.includes(p.id) ? d.filter((x) => x !== p.id) : [...d, p.id]));
                applyFollow(p.id, !following);
                onFollowed(p.id);
              }}
              style={[
                styles.followBtn,
                following
                  ? { borderColor: t.separator, backgroundColor: "transparent" }
                  : { borderColor: t.tint, backgroundColor: t.tint },
              ]}
            >
              <Text
                style={[styles.followBtnText, { color: following ? t.label : "#fff" }]}
              >
                {following ? "Following" : "Follow"}
              </Text>
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export interface DiscoverTabProps {
  /**
   * Driven on every scroll frame so the parent can slide the header and tab bar
   * away. It is an RN `Animated.Value` rather than a Reanimated shared value
   * because the parent's chrome animation is built on the RN driver.
   */
  scrollY?: RNAnimated.Value;
}

export default function DiscoverTab({ scrollY }: DiscoverTabProps) {
  const t = useIOSTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  const [lane, setLane] = React.useState<Lane>("for-you");
  const [tags, setTags] = React.useState<TrendingTag[]>([]);
  const [people, setPeople] = React.useState<SuggestedAccount[]>([]);

  const load = useFeedStore((s) => s.load);

  // FeedList speaks Reanimated; the parent speaks RN Animated. Bridging here
  // keeps both sides idiomatic instead of forcing one to adopt the other.
  const rScrollY = useSharedValue(0);
  const pushToRN = React.useCallback(
    (v: number) => {
      scrollY?.setValue(v);
    },
    [scrollY],
  );
  useAnimatedReaction(
    () => rScrollY.value,
    (v, prev) => {
      if (prev !== null && Math.abs(v - (prev ?? 0)) < 1) return;
      runOnJS(pushToRN)(v);
    },
    [pushToRN],
  );

  React.useEffect(() => {
    trendingHashtags(8).then(setTags);
    suggestedAccounts(5).then(setPeople);
  }, [user?.id]);

  // Outside articles. Shown immediately from what is already stored, then
  // refreshed in the background — a cold fetch of four newsrooms takes a couple
  // of seconds and the feed must not wait on it.
  const [external, setExternal] = React.useState<ExternalPost[]>([]);
  React.useEffect(() => {
    let alive = true;
    listExternalPosts(20).then((rows) => alive && setExternal(rows));
    refreshExternalFeed()
      .then((added) => {
        if (added > 0 && alive) listExternalPosts(20).then((r) => alive && setExternal(r));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const topInset = (Platform.OS === "web" ? 67 : insets.top) + 70;
  const bottomInset = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insets.bottom;

  // Refresh a lane you return to after a long gap. FeedList does the first load
  // itself, so this only covers coming back later — five minutes is long enough
  // not to refetch on every lane flick, short enough that a feed left open
  // overnight is not what greets you in the morning.
  const lastLoaded = React.useRef<Record<string, number>>({});
  React.useEffect(() => {
    const now = Date.now();
    const prev = lastLoaded.current[lane] ?? 0;
    if (prev > 0 && now - prev > 5 * 60_000) load(lane, "refresh");
    lastLoaded.current[lane] = now;
  }, [lane, load]);

  const header = React.useMemo(
    () => (
      <View style={{}}>
        {/* The lane name IS the title, Instagram-style. It reads as a heading
            at rest and only becomes a control when tapped, which is the right
            weight for something changed a few times a day rather than
            constantly. */}
        <View style={[styles.laneWrap, { borderBottomColor: t.separator }]}>
          <IOSTitleDropdown<Lane>
            options={LANES}
            active={lane}
            onChange={setLane}
            overline="Emilgo"
          />
        </View>

        {/* Tapping the row opens the composer rather than focusing an inline
            field. An inline field here would have to survive the list
            recycling its own header, and a half-typed post disappearing on
            scroll is the worst bug a feed can have. */}
        <Pressable
          onPress={() => router.push("/compose" as any)}
          style={[styles.composerRow, { borderBottomColor: t.separator }, {}]}
          accessibilityRole="button"
          accessibilityLabel="Write a post"
        >
          <Avatar name={user?.full_name || "You"} photoUri={user?.profile_photo} size={30} />
          <Text style={[styles.composerHint, { color: t.tertiaryLabel }]}>
            What&apos;s happening ?
          </Text>
        </Pressable>

        {lane === "for-you" ? <TrendingRail tags={tags} /> : null}
        {lane === "following" ? (
          <SuggestionsCard
            people={people}
            onFollowed={() => load("following", "refresh")}
          />
        ) : null}
      </View>
    ),
    [lane, tags, people, t.separator, t.tertiaryLabel, load, router, user],
  );

  return (
    <View style={[styles.root, { backgroundColor: t.systemGroupedBackground }]}>
      <FeedList
        // Each lane gets its own list instance, so switching lanes lands at the
        // top of the new one instead of at whatever offset the old one held.
        key={lane}
        timelineKey={lane}
        header={header}
        topInset={topInset}
        bottomInset={bottomInset}
        scrollY={rScrollY}
        external={lane === "for-you" ? external : []}
        emptyTitle={lane === "following" ? "You're not following anyone yet" : "No post yet"}
        emptyBody={
          lane === "following"
            ? "Follow drivers and passengers you ride with and their posts will show up here."
            : "Be the first to post. Share a route, a fare, or how your day is going."
        }
      />

      {/* Compose. It floats above the list rather than living in the header,
          because the header slides away on scroll and the one control a feed
          must never hide is the one that adds to it. */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push("/compose" as any);
        }}
        style={[styles.composeShadow, { bottom: bottomInset + 44 }]}
        accessibilityRole="button"
        accessibilityLabel="New post"
      >
        <Glass
          variant="regular"
          radius={28}
          style={[styles.compose, { backgroundColor: t.systemGray3 }]}
          // fallbackTint={t.tint}
          fallbackIntensity={0}
        >
          <HugeiconsIcon icon={Plus} size={25} color="#fff" strokeWidth={2} />
        </Glass>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  laneWrap: {
    paddingHorizontal: 16,
    paddingTop: 20,
    // borderBottomWidth: StyleSheet.hairlineWidth
  },

  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    // paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginHorizontal: 15
  },
  composerHint: { ...IOSAppFont.callout, flex: 1 },

  railWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  railHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  railTitle: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },
  railTags: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tagChipText: { ...IOSAppFont.footnote, fontFamily: "Poppins_600SemiBold" },
  tagChipCount: { ...IOSAppFont.caption2, fontVariant: ["tabular-nums"] },

  person: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  personText: { flex: 1, minWidth: 0 },
  personName: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },
  personMeta: { ...IOSAppFont.caption1 },
  followBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  followBtnText: { ...IOSAppFont.caption1, fontFamily: "Poppins_600SemiBold" },

  // Glass clips, so the shadow lives on this wrapper rather than on the button.
  composeShadow: {
    position: "absolute",
    right: 18,
    // shadowColor: "#000",
    // shadowOffset: { width: 0, height: 4 },
    // shadowOpacity: 0.22,
    // shadowRadius: 10,
    // elevation: 6,
    borderRadius: 28,
  },
  compose: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
});
