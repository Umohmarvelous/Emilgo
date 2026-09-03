// app/search.tsx
//
// Search across the feed: posts, people, and hashtags.
//
// ── Why this is a screen and not the ScreenSearch overlay ───────────────────
// `ScreenSearch` searches what a screen already has in memory — the rows on
// Notifications, the fields on Profile. That is the right tool when the corpus
// is small and local, and the wrong one here: the feed's corpus lives in
// Postgres and is searched by `search_posts` against a full-text index. Results
// are posts, and a post is a `PostCard` with working like, reply and bookmark
// buttons, not a one-line result row.
//
// ── Debounce ────────────────────────────────────────────────────────────────
// 350ms. Short enough to feel live while typing a word, long enough that
// "lagos" is one query rather than five. Every keystroke firing a full-text
// search is how a search box becomes the most expensive screen in an app.

import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { ArrowLeft01Icon, FireIcon } from "@hugeicons/core-free-icons";
import { Glass, IOSSearchBar, useIOSTheme } from "@/components/ios";
import { IOSAppFont } from "@/components/ios/theme";
import { FeedList } from "@/components/feed";
import Avatar from "@/components/Avatar";
import FollowButton from "@/components/FollowButton";
import { useFeedStore } from "@/src/store/useFeedStore";
import {
  trendingHashtags,
  suggestedAccounts,
  type TrendingTag,
  type SuggestedAccount,
} from "@/src/services/feed";
import { supabase } from "@/src/services/supabase";

const DEBOUNCE_MS = 350;

interface PersonHit {
  id: string;
  full_name: string | null;
  username: string | null;
  profile_photo: string | null;
  role: string;
}

export default function SearchScreen() {
  const t = useIOSTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const load = useFeedStore((s) => s.load);
  const clear = useFeedStore((s) => s.clear);

  const [raw, setRaw] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [people, setPeople] = React.useState<PersonHit[]>([]);
  const [searchingPeople, setSearchingPeople] = React.useState(false);

  const [tags, setTags] = React.useState<TrendingTag[]>([]);
  const [suggested, setSuggested] = React.useState<SuggestedAccount[]>([]);

  React.useEffect(() => {
    trendingHashtags(10).then(setTags);
    suggestedAccounts(6).then(setSuggested);
  }, []);

  React.useEffect(() => {
    const h = setTimeout(() => setQuery(raw.trim()), DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [raw]);

  // People come from the chat handle search, which matches a username prefix
  // and nothing else. Full names and badge IDs were removed from every typed
  // search path — see migration_user_privacy.sql for the reasoning.
  React.useEffect(() => {
    if (query.length < 2) {
      setPeople([]);
      return;
    }
    let alive = true;
    setSearchingPeople(true);
    supabase
      .rpc("search_users_for_chat", { p_query: query, p_limit: 6 })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) console.warn("[search] people:", error.message);
        setPeople((data ?? []) as PersonHit[]);
        setSearchingPeople(false);
      });
    return () => {
      alive = false;
    };
  }, [query]);

  // Each query is its own timeline key, so results are cached per query and
  // going back to a previous one is instant. Dropping the old one keeps the
  // store from accumulating a timeline per keystroke.
  const prevKey = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!query) return;
    const key = `search:${query}` as const;
    if (prevKey.current && prevKey.current !== key) clear(prevKey.current as any);
    prevKey.current = key;
    load(key, "initial");
  }, [query, load, clear]);

  const topInset = insets.top + 58;

  return (
    <View style={[styles.root, { backgroundColor: t.systemBackground, }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {query ? (
        <FeedList
          key={query}
          timelineKey={`search:${query}`}
          topInset={topInset}
          bottomInset={insets.bottom}
          emptyTitle={`No posts matching "${query}"`}
          emptyBody="Try a different word, a hashtag, or a person's name."
          header={
            people.length ? (
              <View style={[styles.section, { borderBottomColor: t.separator, }]}>
                <Text style={[styles.sectionTitle, { color: t.tertiaryLabel }]}>PEOPLE</Text>
                {people.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => router.push(`/follows/${p.id}` as any)}
                    style={styles.person}
                  >
                    <Avatar
                      name={p.full_name || p.username || "User"}
                      photoUri={p.profile_photo}
                      size={38}
                    />
                    <View style={styles.personText}>
                      <Text style={[styles.personName, { color: t.label }]} numberOfLines={1}>
                        {p.full_name || p.username}
                      </Text>
                      <Text style={[styles.personMeta, { color: t.tertiaryLabel }]} numberOfLines={1}>
                        {p.username ? `@${p.username}` : p.role}
                      </Text>
                    </View>
                    <FollowButton userId={p.id} size="small" />
                  </Pressable>
                ))}
              </View>
            ) : searchingPeople ? (
              <View style={styles.peopleSpinner}>
                <ActivityIndicator color={t.tint} />
              </View>
            ) : null
          }
        />
      ) : (
        // The resting state: what is worth searching for, rather than a blank
        // screen that makes the user guess.
        <ScrollView
          contentContainerStyle={{ paddingTop: topInset + 8, paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.section]}>
            <View style={styles.sectionHead}>
              <HugeiconsIcon icon={FireIcon} size={15} color={t.systemOrange} strokeWidth={2} />
              <Text style={[styles.sectionTitle, { color: t.tertiaryLabel }]}>TRENDING</Text>
            </View>
            {tags.map((tag) => (
              <Pressable
                key={tag.tag}
                onPress={() => router.push(`/hashtag/${encodeURIComponent(tag.tag)}` as any)}
                style={styles.trendRow}
              >
                <Text style={[styles.trendTag, { color: t.label }]}>#{tag.tag}</Text>
                <Text style={[styles.trendMeta, { color: t.tertiaryLabel }]}>
                  {tag.posts} {tag.posts === 1 ? "post" : "posts"}
                </Text>
              </Pressable>
            ))}
            {!tags.length ? (
              <Text style={[styles.trendMeta, { color: t.tertiaryLabel }]}>
                Nothing trending yet.
              </Text>
            ) : null}
          </View>

          {suggested.length ? (
            <View style={[styles.section, { borderTopColor: t.separator, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[styles.sectionTitle, { color: t.tertiaryLabel }]}>PEOPLE TO FOLLOW</Text>
              {suggested.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => router.push(`/follows/${p.id}` as any)}
                  style={styles.person}
                >
                  <Avatar
                    name={p.full_name || p.username || "User"}
                    photoUri={p.profile_photo}
                    size={38}
                  />
                  <View style={styles.personText}>
                    <Text style={[styles.personName, { color: t.label }]} numberOfLines={1}>
                      {p.full_name || p.username}
                    </Text>
                    <Text style={[styles.personMeta, { color: t.tertiaryLabel }]} numberOfLines={1}>
                      {p.username ? `@${p.username}` : p.role}
                      {p.follower_count > 0 ? ` · ${p.follower_count} followers` : ""}
                    </Text>
                  </View>
                  {/* `suggested_accounts` only ever returns people you do not
                      already follow, so the initial state is known and this row
                      costs no extra round trip. */}
                  <FollowButton userId={p.id} initialFollowing={false} size="small" />
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      <View style={[styles.bar, { paddingTop: insets.top, height: topInset }]}>
        <Glass
          variant="regular"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={60}
          fallbackTint={t.systemBackground}
        />
        <View style={styles.barRow}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.back();
            }}
            hitSlop={12}
            accessibilityLabel="Back"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={24} color={t.label} strokeWidth={2} />
          </Pressable>
          <View style={styles.field}>
            <IOSSearchBar
              value={raw}
              onChangeText={setRaw}
              placeholder="Search posts, people and tags"
              autoFocusOnMount
              onCancel={() => router.back()}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20, overflow: "hidden" },
  barRow: { flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 14 },
  field: { flex: 1 },

  section: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { ...IOSAppFont.sectionTitle },

  trendRow: { paddingVertical: 8 },
  trendTag: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },
  trendMeta: { ...IOSAppFont.caption1 },

  person: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  personText: { flex: 1, minWidth: 0 },
  personName: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },
  personMeta: { ...IOSAppFont.caption1 },
  peopleSpinner: { paddingVertical: 18, alignItems: "center" },
});
