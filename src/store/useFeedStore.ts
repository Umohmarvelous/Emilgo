// src/store/useFeedStore.ts
//
// Feed state for every screen that shows a post.
//
// ── Why posts are stored normalised ──────────────────────────────────────────
// The same post appears in the For-you timeline, the Following timeline, a
// thread screen, a profile tab, a hashtag page, search results and bookmarks.
// If each screen kept its own copy, liking a post in the thread screen would
// leave the timeline showing the old count until a refetch — the bug every
// hand-rolled feed ships with.
//
// So there is exactly one copy of each post, in `posts`, keyed by id. A timeline
// is an ordered list of *ids*. Every mutation writes to `posts` once and every
// screen re-renders from it.
//
// ── What is persisted ───────────────────────────────────────────────────────
// The composer draft, the post cache, and the two main timelines.
//
// This used to persist the draft alone, on the theory that a spinner beats a
// stale feed. In practice it produced the opposite: the app cold-starts, the
// feed screen calls `load()` before Supabase has finished restoring the session
// from storage, `feed_for_you` sees `auth.uid() IS NULL` and returns ZERO ROWS
// WITHOUT AN ERROR, and the timeline is marked loaded-and-empty. The user sees
// every post vanish after logging in and stay vanished until a manual pull.
//
// Both halves are fixed here: `load()` now waits for a session instead of
// racing it, and what was on screen last time is still on screen at launch
// while the refresh runs behind it. Counts being a few minutes stale is a much
// smaller problem than a feed that looks empty.
//
// The cache is bounded (`PERSIST_POST_LIMIT`) because AsyncStorage is a single
// JSON blob — an unbounded post cache turns into a multi-megabyte parse on
// every cold start.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../services/supabase";
import * as feed from "../services/feed";
import type { FeedPost, FeedAd, PostMedia, ProfileTab } from "../services/feed";
import { useCreditsStore } from "./useCreditsStore";
import { useAuthStore } from "./useStore";
import { CREDIT_LIKE, CREDIT_COMMENT, CREDIT_SHARE } from "@/constants/credits";

/**
 * Engagement credits, awarded from the one place every like, reply and share
 * actually passes through.
 *
 * Putting this in the store rather than in a screen is what makes it correct:
 * a like fired from the timeline, from a thread, from a profile tab and from
 * search all land here, and all earn the same once. The credits store enforces
 * "once per post" by a deterministic dedupe key, so a user cannot farm credits
 * by liking, unliking and liking again.
 *
 * Awards happen only after the server confirms the action, and never for an
 * undo — crediting an optimistic write that later fails would hand out money
 * for something that did not happen.
 */
function award(type: "like" | "comment" | "share", amount: number, postId: string) {
  const uid = useAuthStore.getState().user?.id;
  if (!uid) return;
  useCreditsStore
    .getState()
    .addCredit(type, amount, uid, postId)
    .catch((e) => console.warn("[feed] credit:", e?.message));
}

export type TimelineKey =
  | "for-you"
  | "following"
  | `thread:${string}`
  | `user:${string}:${ProfileTab}`
  | `hashtag:${string}`
  | `search:${string}`
  | `bookmarks:${string}`;

export const PAGE_SIZE = 6;

/**
 * How many posts sit between two ads. Twitter's spacing, roughly — close enough
 * to be a real revenue slot, far enough apart that the feed still reads as a
 * feed. The first ad never lands at index 0: an ad as the very first thing after
 * a pull-to-refresh reads as a broken app.
 */
export const AD_INTERVAL = 7;
export const AD_FIRST_SLOT = 4;

/**
 * How many posts survive a restart. Enough that every persisted timeline is
 * fully backed, small enough that the rehydrate parse stays imperceptible.
 */
const PERSIST_POST_LIMIT = 250;

/** Timelines worth keeping across launches. A search or a thread is transient. */
const PERSISTED_TIMELINES = ["for-you", "following"] as const;

/**
 * Every feed RPC returns an empty set — not an error — when `auth.uid()` is
 * NULL, so a fetch that beats session restoration looks exactly like "there are
 * no posts". Waiting for the session removes the ambiguity at the source.
 *
 * Supabase reads its stored session asynchronously on boot; `getSession()`
 * resolves once that read is done, so this settles on the first tick in the
 * normal case and only actually waits on a genuine cold start.
 */
async function waitForSession(timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

interface Timeline {
  ids: string[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  exhausted: boolean;
  /** Keyset cursor for `following`; offset-based timelines ignore it. */
  cursor: string | null;
  error: string | null;
  /** Ads drawn for this timeline, consumed positionally by the renderer. */
  ads: FeedAd[];
}

const EMPTY_TIMELINE: Timeline = {
  ids: [],
  loading: false,
  refreshing: false,
  loadingMore: false,
  exhausted: false,
  cursor: null,
  error: null,
  ads: [],
};

export interface ComposerDraft {
  body: string;
  media: PostMedia[];
  replyTo: string | null;
  quoteOf: string | null;
  place: string | null;
  poll: { options: string[]; hours: number } | null;
  updatedAt: number;
}

const EMPTY_DRAFT: ComposerDraft = {
  body: "",
  media: [],
  replyTo: null,
  quoteOf: null,
  place: null,
  poll: null,
  updatedAt: 0,
};

interface FeedState {
  posts: Record<string, FeedPost>;
  timelines: Record<string, Timeline>;
  draft: ComposerDraft;

  /** Ids seen on screen but not yet reported, flushed on a timer. */
  _pendingViews: string[];
  _viewTimer: ReturnType<typeof setTimeout> | null;

  timeline: (key: TimelineKey) => Timeline;
  post: (id: string) => FeedPost | undefined;

  load: (key: TimelineKey, mode?: "initial" | "refresh" | "more") => Promise<void>;
  /** Drop a cached timeline — used when a search query or profile tab changes. */
  clear: (key: TimelineKey) => void;

  like: (id: string) => Promise<void>;
  bookmark: (id: string, collection?: string) => Promise<void>;
  repost: (id: string) => Promise<void>;
  vote: (id: string, choice: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  edit: (id: string, body: string) => Promise<void>;
  hide: (id: string) => Promise<void>;
  report: (id: string, reason: feed.ReportReason, note?: string) => Promise<void>;
  block: (userId: string) => Promise<void>;
  mute: (userId: string, on?: boolean) => Promise<void>;
  /** Reflect a follow made elsewhere onto every post by that author. */
  applyFollow: (userId: string, following: boolean) => void;

  /** Called by the list's viewability callback; batches and debounces. */
  noteViewed: (ids: string[]) => void;

  submit: (input: feed.CreatePostInput) => Promise<string>;
  /** Award the share credit once the OS share sheet has been presented. */
  noteShared: (id: string) => void;

  setDraft: (patch: Partial<ComposerDraft>) => void;
  resetDraft: () => void;

  /** Wipe everything on sign-out, or the next account reads this one's feed. */
  reset: () => void;
}

/** Parse a timeline key into the fetch it stands for. */
function fetcherFor(key: TimelineKey, offset: number, cursor: string | null) {
  if (key === "for-you") return feed.fetchForYou(PAGE_SIZE, offset);
  if (key === "following") return feed.fetchFollowing(PAGE_SIZE, cursor);

  const [kind, ...rest] = key.split(":");
  const arg = rest.join(":");

  switch (kind) {
    case "thread":
      return feed.fetchThread(arg, 100);
    case "user": {
      const sep = arg.lastIndexOf(":");
      return feed.fetchUserPosts(
        arg.slice(0, sep),
        arg.slice(sep + 1) as ProfileTab,
        PAGE_SIZE,
        offset,
      );
    }
    case "hashtag":
      return feed.postsByHashtag(arg, PAGE_SIZE, offset);
    case "search":
      return feed.searchPosts(arg, PAGE_SIZE, offset);
    case "bookmarks":
      return feed.fetchBookmarks(arg || null, PAGE_SIZE, offset);
    default:
      return Promise.resolve([] as FeedPost[]);
  }
}

/** Only the two main timelines carry ads. A thread or a profile does not. */
function wantsAds(key: TimelineKey) {
  return key === "for-you" || key === "following";
}

export const useFeedStore = create<FeedState>()(
  persist(
    (set, get) => ({
      posts: {},
      timelines: {},
      draft: EMPTY_DRAFT,
      _pendingViews: [],
      _viewTimer: null,

      timeline: (key) => get().timelines[key] ?? EMPTY_TIMELINE,
      post: (id) => get().posts[id],

      load: async (key, mode = "initial") => {
        const current = get().timelines[key] ?? EMPTY_TIMELINE;
        if (current.loading || current.refreshing || current.loadingMore) return;
        if (mode === "more" && current.exhausted) return;

        const flag =
          mode === "refresh" ? "refreshing" : mode === "more" ? "loadingMore" : "loading";

        set((s) => ({
          timelines: { ...s.timelines, [key]: { ...current, [flag]: true, error: null } },
        }));

        // Before anything else. Without this the feed silently resolves to []
        // on every cold start that outruns session restoration, and the empty
        // result gets cached as though it were the answer.
        if (!(await waitForSession())) {
          set((s) => ({
            timelines: {
              ...s.timelines,
              [key]: {
                ...(s.timelines[key] ?? EMPTY_TIMELINE),
                loading: false,
                refreshing: false,
                loadingMore: false,
                // Explicitly NOT `exhausted`, and the existing ids are left
                // alone: this is "we could not ask", not "there is nothing".
                error: "Signing you in…",
              },
            },
          }));
          return;
        }

        const offset = mode === "more" ? current.ids.length : 0;
        const cursor = mode === "more" ? current.cursor : null;

        try {
          const rows = await fetcherFor(key, offset, cursor);

          // Ads are drawn once per page so a long scroll keeps rotating them,
          // rather than showing the same three creatives all the way down.
          const ads =
            wantsAds(key) && rows.length
              ? await feed.serveFeedAds(Math.max(1, Math.ceil(rows.length / AD_INTERVAL)))
              : [];

          set((s) => {
            const posts = { ...s.posts };
            for (const p of rows) posts[p.id] = p;

            const prev = s.timelines[key] ?? EMPTY_TIMELINE;
            const incoming = rows.map((p) => p.id);

            // Appending without deduping double-renders a post when someone
            // posts between two page fetches and shifts the offset window.
            const ids =
              mode === "more"
                ? [...prev.ids, ...incoming.filter((id) => !prev.ids.includes(id))]
                : incoming;

            const last = rows[rows.length - 1];

            return {
              posts,
              timelines: {
                ...s.timelines,
                [key]: {
                  ...prev,
                  ids,
                  loading: false,
                  refreshing: false,
                  loadingMore: false,
                  exhausted: rows.length < PAGE_SIZE,
                  cursor: last ? last.created_at : prev.cursor,
                  error: null,
                  ads: mode === "more" ? [...prev.ads, ...ads] : ads,
                },
              },
            };
          });
        } catch (e: any) {
          set((s) => ({
            timelines: {
              ...s.timelines,
              [key]: {
                ...(s.timelines[key] ?? EMPTY_TIMELINE),
                loading: false,
                refreshing: false,
                loadingMore: false,
                error: e?.message ?? "Could not load",
              },
            },
          }));
        }
      },

      clear: (key) =>
        set((s) => {
          const next = { ...s.timelines };
          delete next[key];
          return { timelines: next };
        }),

      // ── Optimistic toggles ────────────────────────────────────────────────
      // Each flips the flag and the count immediately, then reconciles against
      // the authoritative number the RPC returns. On failure it restores the
      // exact prior post, because a half-applied toggle leaves the user unable
      // to tell which state they are in.

      like: async (id) => {
        const before = get().posts[id];
        if (!before) return;
        set((s) => ({
          posts: {
            ...s.posts,
            [id]: {
              ...before,
              viewer_liked: !before.viewer_liked,
              like_count: Math.max(0, before.like_count + (before.viewer_liked ? -1 : 1)),
            },
          },
        }));
        try {
          const { on, n } = await feed.toggleLike(id);
          set((s) => ({
            posts: {
              ...s.posts,
              [id]: { ...(s.posts[id] ?? before), viewer_liked: on, like_count: n },
            },
          }));
          if (on) award("like", CREDIT_LIKE, id);
        } catch {
          set((s) => ({ posts: { ...s.posts, [id]: before } }));
        }
      },

      bookmark: async (id, collection = "") => {
        const before = get().posts[id];
        if (!before) return;
        set((s) => ({
          posts: {
            ...s.posts,
            [id]: {
              ...before,
              viewer_bookmarked: !before.viewer_bookmarked,
              bookmark_count: Math.max(
                0,
                before.bookmark_count + (before.viewer_bookmarked ? -1 : 1),
              ),
            },
          },
        }));
        try {
          const { on, n } = await feed.toggleBookmark(id, collection);
          set((s) => ({
            posts: {
              ...s.posts,
              [id]: { ...(s.posts[id] ?? before), viewer_bookmarked: on, bookmark_count: n },
            },
          }));
        } catch {
          set((s) => ({ posts: { ...s.posts, [id]: before } }));
        }
      },

      repost: async (id) => {
        const before = get().posts[id];
        if (!before) return;
        set((s) => ({
          posts: {
            ...s.posts,
            [id]: {
              ...before,
              viewer_reposted: !before.viewer_reposted,
              repost_count: Math.max(0, before.repost_count + (before.viewer_reposted ? -1 : 1)),
            },
          },
        }));
        try {
          const { on, n } = await feed.toggleRepost(id);
          set((s) => ({
            posts: {
              ...s.posts,
              [id]: { ...(s.posts[id] ?? before), viewer_reposted: on, repost_count: n },
            },
          }));
        } catch {
          set((s) => ({ posts: { ...s.posts, [id]: before } }));
        }
      },

      // A poll is not optimistic: the server recomputes every bar, and guessing
      // the new percentages would visibly correct itself a moment later.
      vote: async (id, choice) => {
        const { my_choice, tallies } = await feed.votePoll(id, choice);
        set((s) => {
          const p = s.posts[id];
          if (!p?.poll) return {};
          // MERGE, never replace. `vote_poll` returns tallies and the viewer's
          // choice and nothing else — assigning its result straight onto the
          // post wiped `options` and `ends_at`, and the card crashed on the
          // next render trying to map over an array that no longer existed.
          const votes = p.poll.options.map((_, i) => Number(tallies[i] ?? 0));
          return {
            posts: {
              ...s.posts,
              [id]: {
                ...p,
                poll: {
                  ...p.poll,
                  my_choice,
                  votes,
                  total: votes.reduce((a, b) => a + b, 0),
                },
              },
            },
          };
        });
      },

      remove: async (id) => {
        await feed.deletePost(id);
        set((s) => {
          const posts = { ...s.posts };
          delete posts[id];
          const timelines: Record<string, Timeline> = {};
          for (const [k, t] of Object.entries(s.timelines)) {
            timelines[k] = { ...t, ids: t.ids.filter((x) => x !== id) };
          }
          return { posts, timelines };
        });
      },

      edit: async (id, body) => {
        await feed.editPost(id, body);
        // Refetch rather than patch: editing rewrites hashtags and mentions
        // server-side, so the local row would be subtly wrong.
        const fresh = await feed.fetchPost(id);
        if (fresh) set((s) => ({ posts: { ...s.posts, [id]: fresh } }));
      },

      hide: async (id) => {
        await feed.hidePost(id);
        set((s) => {
          const timelines: Record<string, Timeline> = {};
          for (const [k, t] of Object.entries(s.timelines)) {
            timelines[k] = { ...t, ids: t.ids.filter((x) => x !== id) };
          }
          return { timelines };
        });
      },

      report: async (id, reason, note) => {
        await feed.reportPost(id, reason, note);
        // Reporting implies not wanting to see it again.
        await get().hide(id);
      },

      block: async (userId) => {
        await feed.blockUser(userId);
        set((s) => {
          const gone = new Set(
            Object.values(s.posts)
              .filter((p) => p.author_id === userId)
              .map((p) => p.id),
          );
          const posts = { ...s.posts };
          for (const id of gone) delete posts[id];
          const timelines: Record<string, Timeline> = {};
          for (const [k, t] of Object.entries(s.timelines)) {
            timelines[k] = { ...t, ids: t.ids.filter((x) => !gone.has(x)) };
          }
          return { posts, timelines };
        });
      },

      mute: async (userId, on = true) => {
        await feed.muteUser(userId, on);
        if (!on) return;
        set((s) => {
          const gone = new Set(
            Object.values(s.posts)
              .filter((p) => p.author_id === userId)
              .map((p) => p.id),
          );
          const timelines: Record<string, Timeline> = {};
          for (const [k, t] of Object.entries(s.timelines)) {
            timelines[k] = { ...t, ids: t.ids.filter((x) => !gone.has(x)) };
          }
          return { timelines };
        });
      },

      applyFollow: (userId, following) =>
        set((s) => {
          const posts = { ...s.posts };
          let touched = false;
          for (const [id, p] of Object.entries(posts)) {
            if (p.author_id === userId && p.viewer_follows_author !== following) {
              posts[id] = { ...p, viewer_follows_author: following };
              touched = true;
            }
          }
          return touched ? { posts } : {};
        }),

      // Views are batched: a fast scroll can cross forty posts in a second and
      // forty round trips would be forty chances to jank the list.
      noteViewed: (ids) => {
        const { _pendingViews, _viewTimer } = get();
        const merged = Array.from(new Set([..._pendingViews, ...ids]));
        if (merged.length === _pendingViews.length) return;

        if (_viewTimer) clearTimeout(_viewTimer);
        const timer = setTimeout(() => {
          const batch = get()._pendingViews;
          set({ _pendingViews: [], _viewTimer: null });
          feed.markViewed(batch);
        }, 2000);

        set({ _pendingViews: merged, _viewTimer: timer });
      },

      submit: async (input) => {
        const id = await feed.createPost(input);
        const fresh = await feed.fetchPost(id);
        if (fresh) {
          set((s) => {
            const posts = { ...s.posts, [id]: fresh };
            const timelines = { ...s.timelines };

            // A new top-level post belongs at the head of the timelines the
            // author is looking at; a reply belongs at the tail of its thread.
            if (input.replyTo) {
              const key = `thread:${input.replyTo}`;
              const t = timelines[key];
              if (t) timelines[key] = { ...t, ids: [...t.ids, id] };
              const parent = posts[input.replyTo];
              if (parent) {
                posts[input.replyTo] = { ...parent, reply_count: parent.reply_count + 1 };
              }
            } else {
              for (const key of ["for-you", "following"] as const) {
                const t = timelines[key];
                if (t) timelines[key] = { ...t, ids: [id, ...t.ids] };
              }
            }
            return { posts, timelines };
          });
        }
        // Commenting earns credits; posting to your own timeline does not, or
        // the cheapest way to farm would be to post nonsense all day.
        if (input.replyTo) award("comment", CREDIT_COMMENT, input.replyTo);

        get().resetDraft();
        return id;
      },

      /**
       * Called by a card once the OS share sheet has actually been presented.
       * The store cannot fire this itself because sharing is a UI affordance,
       * but the credit must still be awarded from one place.
       */
      noteShared: (id) => award("share", CREDIT_SHARE, id),

      setDraft: (patch) =>
        set((s) => ({ draft: { ...s.draft, ...patch, updatedAt: Date.now() } })),

      resetDraft: () => set({ draft: EMPTY_DRAFT }),

      reset: () => {
        const t = get()._viewTimer;
        if (t) clearTimeout(t);
        set({ posts: {}, timelines: {}, draft: EMPTY_DRAFT, _pendingViews: [], _viewTimer: null });
      },
    }),
    {
      name: "emilgo-feed",
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,

      partialize: (s) => {
        // Persist only the timelines worth restoring, and only the ids — ads
        // are bought impressions and must be re-served, never replayed from
        // disk, or the advertiser is billed for a view that never happened.
        const timelines: Record<string, Timeline> = {};
        const keep = new Set<string>();
        for (const key of PERSISTED_TIMELINES) {
          const t = s.timelines[key];
          if (!t?.ids.length) continue;
          timelines[key] = {
            ...t,
            ads: [],
            // Transient flags must never be written. A persisted `loading:true`
            // rehydrates as a timeline that `load()` refuses to touch — a feed
            // that is stuck forever and looks like a network bug.
            loading: false,
            refreshing: false,
            loadingMore: false,
            error: null,
          };
          for (const id of t.ids) keep.add(id);
        }

        // Only posts actually referenced by a persisted timeline, newest first.
        const posts: Record<string, FeedPost> = {};
        const referenced = Object.values(s.posts)
          .filter((p) => keep.has(p.id))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .slice(0, PERSIST_POST_LIMIT);
        for (const p of referenced) posts[p.id] = p;

        return { draft: s.draft, posts, timelines };
      },

      // Belt and braces for anything written by an older build, which did not
      // strip the flags above.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const t of Object.values(state.timelines)) {
          t.loading = false;
          t.refreshing = false;
          t.loadingMore = false;
          t.error = null;
          t.ads = [];
        }
      },
    },
  ),
);
