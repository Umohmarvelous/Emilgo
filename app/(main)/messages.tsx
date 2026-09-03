// app/(main)/messages.tsx
//
// The inbox. Conversation list, search, and the new-message sheet — nothing
// else.
//
// ── What this file stopped doing ───────────────────────────────────────────
// It used to render the chat SCREEN inline when a trip conversation was tapped,
// while direct conversations navigated to `/direct-chat/[conversationId]`. Two
// ways into a chat that behaved differently: the inline one needed the layout
// told to hide the tab bar, and its back button called `onBack()` AND
// `router.back()`, which popped the Messages tab off the stack — so closing a
// chat navigated out of Messages entirely.
//
// Every conversation opens the same route now. The tab bar is covered because
// the route sits above this whole group, not because anything was asked to hide.
//
// ── Where the list comes from ──────────────────────────────────────────────
// `chat_list_conversations()`, pulled on mount and on pull-to-refresh. It used
// to come only from the persisted cache plus whatever realtime happened to
// deliver, and "refresh" was `await new Promise(r => setTimeout(r, 700))` — a
// spinner that fetched nothing.

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router }               from 'expo-router';
import { useSafeAreaInsets }    from 'react-native-safe-area-context';
import * as Haptics             from 'expo-haptics';
import { useAuthStore }         from '@/src/store/useStore';
import { useSettingsStore }     from '@/src/store/useSettingsStore';
import {
  useMessagesStore,
  type ChatCandidate,
  type Conversation,
} from '@/src/store/useMessagesStore';
import { Colors }   from '@/constants/colors';
import Avatar       from '@/components/Avatar';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  Message02Icon,
  PlusSignIcon,
  TelegramIcon,
  Search01Icon,
  UserIcon,        // ← new: used for direct-chat list items
  Cancel01Icon,
  Chat,
  StarIcon,
  PaintBoardIcon,
  PinIcon,
  NotificationOff01Icon,
} from '@hugeicons/core-free-icons';
import { StatusBar }  from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  Glass, iosAlert, iosActionSheet, IOSBadge, IOSSearchBar, IOSSheet,
  NetworkStatus, SwipeableRow, useIOSTheme,
} from "@/components/ios";
import { isMuted, MUTE_OPTIONS, muteUntilISO } from "@/src/services/chat";
// Voice notes run on expo-audio.
//
// This used to be a stub whose permission request always returned "denied",
// left behind when expo-av was removed — so the whole recording UI was live and
// did nothing. expo-audio is the supported replacement and is hook-based rather
// than imperative, which is why the recorder is created at the top of
// ChatScreen instead of inside the press handler.

// ─── The chat screen ────────────────────────────────────────────────────────
//
// It used to live inline here, all 577 lines of it, which is how the app ended
// up with two chat screens: `app/direct-chat/[conversationId].tsx` is the route
// nine screens actually push to, and it never imported any of this despite the
// comment at the top of this file saying it did. Every improvement landed in
// the copy almost nobody opened.
//
// One implementation now, in `components/chat/ChatScreen.tsx`, rendered by both
// entry points. Re-exported here because existing call sites import it from
// this module.
// `ChatScreen` used to be re-exported from here, which is exactly the fiction
// that let two chat screens exist: this file looked like the owner. It lives in
// components/chat/ChatScreen.tsx and the ROUTE renders it.

// ─── New Message sheet — username only ───────────────────────────────────────
//
// Results at the top, the field docked at the bottom. That is not decoration:
// the keyboard pins the field to the bottom of the sheet, so results rendered
// beneath it are pushed off-screen the moment anyone types. Above the field
// also puts the newest match closest to the thumb.
//
// It opens a chat by navigating, not by handing a half-built Conversation back
// to the parent. `fetchConversationByDriverId` already creates the row
// server-side and returns the real one, so the old `onStart` round trip was
// constructing a second, client-invented conversation object for the same
// thread.

function NewChatModal({
  visible, onClose, isDark,
}: {
  visible:  boolean;
  onClose:  () => void;
  isDark:   boolean;
}) {
  const { user }                          = useAuthStore();
  const { fetchConversationByDriverId, searchUsersForChat } = useMessagesStore();

  // Username is the only way in. The "Trip Code" tab is gone, and so is the
  // state that served it: a trip code resolved to a person through the same
  // lookup a username does, so it was a second door to one room — and it was
  // the door still accepting driver badge IDs after IDs were removed from
  // search everywhere else.
  const [query, setQuery] = useState('');

  // Handle tab — loading state for fetchConversationByHandle
  const [driverLoading, setDriverLoading] = useState(false);
  const [driverError,   setDriverError]   = useState('');

  // Type-ahead. Debounced because every keystroke is a network round trip, and
  // an un-debounced field fires one per character while the user is still
  // typing the handle they already know.
  const [suggestions, setSuggestions] = useState<ChatCandidate[]>([]);
  useEffect(() => {
    const typed = query.trim();
    if (typed.replace(/^@/, '').length < 2) { setSuggestions([]); return; }

    let cancelled = false;
    const t = setTimeout(async () => {
      const found = await searchUsersForChat(typed);
      if (!cancelled) setSuggestions(found);
    }, 280);

    return () => { cancelled = true; clearTimeout(t); };
  }, [query, searchUsersForChat]);

  const textColor = isDark ? Colors.textWhite     : Colors.text;
  const subTextColor  = isDark ? Colors.textSecondary : Colors.textTertiary;
  const border    = isDark ? 'rgba(255,255,255,0.12)' : '#E8ECF0';
  const inputBg   = isDark ? Colors.background    : '#F4F6FA';
  // const tabBg     = isDark ? '#1A1A2E' : '#F0F2F5';
  const tabBg     = isDark ? Colors.textSecondary : Colors.border;

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setDriverError(''); setDriverLoading(false);
    }
  }, [visible]);

  const reset = () => setDriverError('');

  // ── Driver ID direct-chat (new) ───────────────────────────────────────────
  /** Open a chat with a handle — from the field, or from a tapped suggestion. */
  const openWith = async (handle: string) => {
    const raw = handle.trim();
    if (!raw || !user?.id) return;
    setDriverLoading(true);
    setDriverError('');
    try {
      const { driverUser, conversation } = await fetchConversationByDriverId(raw, user.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
      router.push({
        pathname: '/direct-chat/[conversationId]',
        params: {
          conversationId: conversation.id,
          driverName:     driverUser.full_name ?? 'Emilgo user',
          driverId:       driverUser.driver_id ?? '',
        },
      });
    } catch (err: any) {
      setDriverError(err?.message ?? 'No account with that username. Check the spelling.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setDriverLoading(false);
    }
  };

  /** Submit whatever is in the field. */
  const handleHandleSearch = () => openWith(query);

  return (
    <IOSSheet
      visible={visible}
      onClose={onClose}
      // Two detents so it can be dragged up when the results fill it, and
      // flicked down to dismiss. That gesture is why this is an IOSSheet and no
      // longer a bare Modal with a hand-drawn grabber that did nothing.
      detents={[0.62, "large"]}
      title="New Message"
      showGrabber
      dismissible
      contentStyle={{ paddingHorizontal: 0 }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={S.newBody}
      >
        {/* ── Results, at the TOP ──────────────────────────────────────────
            The field is docked at the bottom by the keyboard, so results
            rendered underneath it would be pushed off-screen the moment
            anyone typed. Putting them above means the newest match sits
            closest to the thumb, which is also how every messaging app that
            has solved this lays it out. `inverted` keeps the list pinned to
            the bottom of its own space, so one result appears right above the
            field instead of stranded at the top of an empty sheet. */}
        <ScrollView
          style={S.newResults}
          contentContainerStyle={S.newResultsInner}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
        >
          {suggestions.length > 0 ? (
            suggestions.map((person) => (
              <Pressable
                key={person.id}
                style={({ pressed }) => [
                  S.suggestionRow,
                  { borderBottomColor: border },
                  pressed && { backgroundColor: inputBg },
                ]}
                onPress={() => openWith(person.username ? `@${person.username}` : '')}
              >
                <Avatar name={person.full_name || 'User'} photoUri={person.profile_photo ?? undefined} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[S.suggestionName, { color: textColor }]} numberOfLines={1}>
                    {person.full_name || 'Emilgo user'}
                  </Text>
                  <Text style={[S.suggestionMeta, { color: subTextColor }]} numberOfLines={1}>
                    @{person.username}
                    {person.vehicle_details ? ` · ${person.vehicle_details}` : ''}
                  </Text>
                </View>
                <Text style={[S.suggestionRole, { color: Colors.primary }]}>{person.role}</Text>
              </Pressable>
            ))
          ) : (
            <View style={S.newEmpty}>
              <HugeiconsIcon icon={Message02Icon} size={40} color={subTextColor} />
              <Text style={[S.newEmptyTitle, { color: textColor }]}>
                {query.trim().length >= 2 && !driverLoading
                  ? 'No one found'
                  : 'Find someone by username'}
              </Text>
              <Text style={[S.newEmptyText, { color: subTextColor }]}>
                {query.trim().length >= 2 && !driverLoading
                  ? `No username starts with "${query.trim().replace(/^@/, '')}". Handles are matched from the start, so check the spelling.`
                  : 'Start typing a username and suggestions appear here.'}
              </Text>
            </View>
          )}

          {driverError ? (
            <Text style={[S.driverError, { color: Colors.error }]}>{driverError}</Text>
          ) : null}
        </ScrollView>

        {/* ── Search, docked at the BOTTOM ─────────────────────────────── */}
        <View style={[S.newDock, { borderTopColor: border, backgroundColor: tabBg }]}>
          <View style={[S.newInputRow, { backgroundColor: inputBg, borderColor: border }]}>
            <HugeiconsIcon icon={Search01Icon} size={18} color={subTextColor} />
            <TextInput
              style={[S.newInput, { color: textColor }]}
              placeholder="@username"
              placeholderTextColor={subTextColor}
              value={query}
              onChangeText={(v) => { setQuery(v); reset(); }}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={handleHandleSearch}
            />
            {query.length > 0 && (
              <Pressable hitSlop={8} onPress={() => { setQuery(''); reset(); }}>
                <HugeiconsIcon icon={Cancel01Icon} size={16} color={subTextColor} />
              </Pressable>
            )}
          </View>

          <Pressable
            style={[S.newDockBtn, {
              backgroundColor: query.trim() ? Colors.primary : inputBg,
              opacity: driverLoading ? 0.7 : 1,
            }]}
            onPress={handleHandleSearch}
            disabled={!query.trim() || driverLoading}
            accessibilityRole="button"
            accessibilityLabel="Open chat"
          >
            {driverLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : <HugeiconsIcon icon={TelegramIcon} size={18} color={query.trim() ? '#fff' : subTextColor} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </IOSSheet>
  );
}

// ─── Conversation List Item ───────────────────────────────────────────────────

/**
 * People matching the search who are NOT already in the chat list.
 *
 * WhatsApp's search does exactly this: your own chats first, then everyone else
 * who could be one. Without the second section a search for a driver you have
 * never messaged returns "no results" even though they are right there in the
 * database — which is what made the old search feel broken.
 */
function NewContactResults({
  hits,
  searching,
  query,
  onPick,
}: {
  hits: ChatCandidate[];
  searching: boolean;
  query: string;
  onPick: (c: ChatCandidate) => void;
}) {
  const t = useIOSTheme();

  if (searching && !hits.length) {
    return (
      <View style={S.newSectionSpinner}>
        <ActivityIndicator color={t.tint} />
      </View>
    );
  }
  if (!hits.length) {
    return (
      <View style={S.newSectionEmpty}>
        <Text style={[S.newSectionEmptyText, { color: t.tertiaryLabel }]}>
          No username starts with “{query.replace(/^@/, '')}”. Handles are matched
          from the start, so check the spelling.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={[S.newSectionTitle, { color: t.tertiaryLabel }]}>START A NEW CHAT</Text>
      {hits.map((c) => (
        <Pressable
          key={c.id}
          onPress={() => onPick(c)}
          style={({ pressed }) => [
            S.newContactRow,
            { borderBottomColor: t.separator },
            pressed && { backgroundColor: t.tertiarySystemFill },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Message ${c.full_name || c.username}`}
        >
          <Avatar name={c.full_name || c.username || 'User'} photoUri={c.profile_photo} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[S.newContactName, { color: t.label }]} numberOfLines={1}>
              {c.full_name || c.username}
            </Text>
            <Text style={[S.newContactMeta, { color: t.tertiaryLabel }]} numberOfLines={1}>
              {[c.username ? `@${c.username}` : null, c.driver_id, c.vehicle_details]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          {c.avg_rating ? (
            <Text style={[S.newContactRating, { color: t.secondaryLabel }]}>
              ★ {c.avg_rating.toFixed(1)}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

/** Bold just the part of `text` that matched, WhatsApp-style. */
function Highlight({
  text, query, style, highlightColour, ...rest
}: {
  text: string;
  query: string;
  style?: any;
  highlightColour: string;
} & React.ComponentProps<typeof Text>) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <Text style={style} {...rest}>{text}</Text>;
  return (
    <Text style={style} {...rest}>
      {text.slice(0, i)}
      <Text style={{ color: highlightColour, fontFamily: 'Poppins_700Bold' }}>
        {text.slice(i, i + query.length)}
      </Text>
      {text.slice(i + query.length)}
    </Text>
  );
}

function ConvItem({
  item, onPress, onDelete, onPin, onMute, onArchive, onToggleRead, query = '',
}: {
  item:     Conversation;
  onPress:  () => void;
  onDelete: () => void;
  onPin:    () => void;
  onMute:   () => void;
  onArchive:() => void;
  onToggleRead: () => void;
  /** Current search term, so the matched span can be highlighted. */
  query?:   string;
}) {
  const ios = useIOSTheme();

  // WhatsApp's rule: a time for today, "Yesterday", a weekday inside a week,
  // then a date. A bare clock time on a three-week-old chat is meaningless.
  const timeStr = (() => {
    if (!item.last_message_at) return '';
    const d = new Date(item.last_message_at);
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
    if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
  })();

  // Direct chats get a person icon; trip-based chats keep the default
  const isDirectChat = item.id.startsWith('direct_');
  const unread = item.unread_count ?? 0;
  const muted  = isMuted(item.muted_until);
  const textColor = ios.label;
  const subTextColor = ios.secondaryLabel;
  const border = ios.separator;

  return (
    <SwipeableRow
      actions={[
        {
          key: 'pin',
          label: item.pinned ? 'Unpin' : 'Pin',
          symbol: item.pinned ? 'pin.slash.fill' : 'pin.fill',
          color: ios.systemOrange,
          onPress: onPin,
        },
        {
          key: 'mute',
          label: muted ? 'Unmute' : 'Mute',
          symbol: muted ? 'bell.fill' : 'bell.slash.fill',
          color: ios.systemGray,
          onPress: onMute,
        },
        {
          key: 'read',
          label: unread > 0 ? 'Read' : 'Unread',
          symbol: unread > 0 ? 'envelope.open.fill' : 'envelope.badge.fill',
          color: ios.tint,
          onPress: onToggleRead,
        },
        {
          key: 'archive',
          label: item.archived ? 'Unarchive' : 'Archive',
          symbol: 'archivebox.fill',
          color: ios.systemBlue,
          onPress: onArchive,
        },
        {
          key: 'delete',
          label: 'Delete',
          symbol: 'trash.fill',
          color: ios.systemRed,
          destructive: true,
          // Deleting a conversation destroys its whole history and cannot be
          // undone, so a full swipe asks first. The old row deleted outright.
          onPress: () =>
            iosAlert(
              `Delete chat with ${item.participant_name || 'this contact'}?`,
              'The messages in this conversation will be removed from this device.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: onDelete },
              ],
            ),
        },
      ]}
    >
      <Pressable
        style={({ pressed }) => [
          S.convItem,
          { backgroundColor:  ios.systemBackground, borderBottomColor: border },
          pressed && { opacity: 0.85 },
        ]}
        onPress={onPress}
      >
        <View style={{ position: 'relative' }}>
          <Avatar
            name={item.participant_name || 'Driver'}
            photoUri={item.participant_photo}
            size={70}
            style={{borderWidth: 1, borderColor: ios.secondarySystemFill}}
          />
          {/* Direct-chat badge */}
          {isDirectChat && (
            <View style={[S.directBadge, { backgroundColor: ios.tint, borderColor: ios.systemBackground }]}>
              <HugeiconsIcon icon={UserIcon} size={9} color="#fff" />
            </View>
          )}
          {/* The green dot here was driven by `unread_count`, so it claimed the
              person was ONLINE whenever they had sent something unread. It said
              nothing true and duplicated the badge below, so it is gone. */}
        </View>
        <View style={S.convText}>
          <View style={S.convTopRow}>
            {item.pinned ? (
              <HugeiconsIcon icon={PinIcon} size={12} color={ios.tertiaryLabel} />
            ) : null}
            <Highlight
              text={item.participant_name || 'Driver'}
              query={query}
              highlightColour={ios.tint}
              style={[S.convName, { color: textColor }, unread > 0 && S.convNameUnread]}
              numberOfLines={1}
            />
            <Text style={[S.convTime, { color: unread > 0 && !muted ? ios.tint : subTextColor }]}>
              {timeStr}
            </Text>
          </View>
          <View style={S.convBottomRow}>
            <Text
              style={[
                S.convLast,
                { color: unread > 0 ? textColor : subTextColor },
                unread > 0 && S.convLastUnread,
              ]}
              numberOfLines={1}
            >
              {item.last_message || (isDirectChat ? 'Direct message' : 'Tap to start chatting')}
            </Text>
            {/* Muted still counts — muting silences the alert, not the fact
                that something is waiting. It just stops being tinted. */}
            {muted ? (
              <HugeiconsIcon icon={NotificationOff01Icon} size={13} color={ios.tertiaryLabel} />
            ) : null}
            <IOSBadge count={unread} />
          </View>
          {item.participant_username || item.participant_driver_id ? (
            <Highlight
              text={
                item.participant_username
                  ? `@${item.participant_username}`
                  : item.participant_driver_id!
              }
              query={query}
              highlightColour={ios.tint}
              style={[S.convDriverId, { color: ios.tertiaryLabel }]}
              numberOfLines={1}
            />
          ) : null}
        </View>
      </Pressable>
    </SwipeableRow>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

type Filter = 'all' | 'unread' | 'archived';

export default function MessagesTab() {
  const insets = useSafeAreaInsets();
  const { theme }  = useSettingsStore();
  const { user }   = useAuthStore();
  const {
    conversations, deleteConversation, subscribeToRealtime,
    searchUsersForChat, startDirectChat, loadConversations,
    setPrefs, markRead, markUnread,
  } = useMessagesStore();

  const ios = useIOSTheme();

  // Live contact search. The bar used to be `asButton` and opened an overlay
  // that was commented out, so tapping Search did nothing at all.
  const [query, setQuery] = useState("");
  // Debounced copy of `query`, used only for the REMOTE lookup — filtering the
  // local list is instant and should not wait 300ms.
  const [remoteQuery, setRemoteQuery] = useState("");
  const [remoteHits, setRemoteHits] = useState<ChatCandidate[]>([]);
  const [remoteSearching, setRemoteSearching] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const h = setTimeout(() => setRemoteQuery(query.trim()), 300);
    return () => clearTimeout(h);
  }, [query]);

  const [newChatVisible,  setNewChatVisible]  = useState(false);
  const [refreshing,      setRefreshing]      = useState(false);

  const isDark    = theme === 'dark';
  const textColor = isDark ? Colors.textWhite     : Colors.text;
  const subTextColor  = isDark ? Colors.textSecondary : Colors.textTertiary;
  const topPad    = Platform.OS === 'web' ? 67 : insets.top;

  const subscribeRef = useRef(subscribeToRealtime);
  useEffect(() => { subscribeRef.current = subscribeToRealtime; });

  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeRef.current(user.id);
    return () => unsub?.();
  }, [user?.id]);

  // The list is a server query now. Without this the tab showed whatever was
  // in the persisted cache — which on a fresh install is nothing at all, and
  // after a reinstall is nothing forever, because realtime only ever delivers
  // what arrives AFTER you are listening.
  useEffect(() => {
    if (!user?.id) return;
    loadConversations(user.id, user.role === 'driver' ? 'driver' : 'passenger');
  }, [user?.id, user?.role, loadConversations]);

  /**
   * The rows to show.
   *
   * `chat_list_conversations` already returns only conversations this user is
   * in, resolved to the other person and ordered pinned-first. The old
   * client-side role filter here let a passenger through unconditionally
   * (`return true`) and guessed for a driver — so it was either redundant or
   * wrong depending on who was looking.
   */
  const visible = useMemo(
    () => conversations.filter((c) => (filter === 'archived' ? c.archived : !c.archived)),
    [conversations, filter],
  );

  const archivedCount = useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations],
  );

  // Local filter: instant, over what is already on screen.
  const filtered = useMemo(() => {
    const base = filter === 'unread' ? visible.filter((c) => (c.unread_count ?? 0) > 0) : visible;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    const needle = q.replace(/^@/, '');
    return base.filter((c) =>
      [
        c.participant_name,
        c.participant_username,
        c.participant_driver_id,
        c.last_message,
        c.trip_code,
      ]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(needle)),
    );
  }, [visible, query, filter]);

  // Remote lookup: people you have NOT chatted with yet. This is what makes the
  // search bar answer "who can I message?" rather than only "which of my
  // existing chats mentions this word?".
  useEffect(() => {
    const q = remoteQuery.replace(/^@/, '');
    if (q.length < 2) {
      setRemoteHits([]);
      return;
    }
    let alive = true;
    setRemoteSearching(true);
    searchUsersForChat(q)
      .then((rows) => {
        if (!alive) return;
        // Anyone already in the list above would be a duplicate row.
        const known = new Set(visible.map((c) => c.participant_id));
        setRemoteHits(rows.filter((r) => r.id !== user?.id && !known.has(r.id)));
      })
      .finally(() => alive && setRemoteSearching(false));
    return () => {
      alive = false;
    };
  }, [remoteQuery, searchUsersForChat, visible, user?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConversations(user?.id, user?.role === 'driver' ? 'driver' : 'passenger');
    setRefreshing(false);
  }, [loadConversations, user?.id, user?.role]);

  /** One route in. See the note at the top of this file for why. */
  const open = useCallback((c: Conversation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/direct-chat/[conversationId]',
      params: {
        conversationId: c.id,
        driverName:     c.participant_name,
        driverId:       c.participant_driver_id ?? '',
      },
    });
  }, []);

  /**
   * Open (or create) a chat with someone found by the search bar.
   *
   * `startDirectChat` is idempotent on the conversation id, so tapping the same
   * person twice reopens the existing thread rather than making a second one.
   */
  const openWithCandidate = useCallback(
    async (c: ChatCandidate) => {
      if (!user?.id) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const conv = await startDirectChat(user.id, c.id);
        setQuery('');
        router.push({
          pathname: '/direct-chat/[conversationId]',
          params: {
            conversationId: conv.id,
            driverName:     conv.participant_name,
            driverId:       conv.participant_driver_id ?? '',
          },
        });
      } catch (e: any) {
        iosAlert("Couldn't open chat", e?.message ?? 'Please try again.');
      }
    },
    [user?.id, startDirectChat],
  );

  const confirmDelete = (id: string) => {
    iosAlert('Delete conversation', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteConversation(id) },
    ]);
  };

  /** Mute asks for how long, exactly as the in-chat menu does. */
  const askMute = (c: Conversation) => {
    if (isMuted(c.muted_until)) {
      setPrefs(c.id, { clearMute: true });
      return;
    }
    iosActionSheet(
      'Mute notifications',
      `You will stop getting alerts from ${c.participant_name || 'this chat'}. It stays in your list and still counts as unread.`,
      [
        ...MUTE_OPTIONS.map((o) => ({
          text: o.label,
          onPress: () => setPrefs(c.id, { mutedUntil: muteUntilISO(o.hours) }),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  const filters: { key: Filter; label: string; badge?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    ...(archivedCount ? [{ key: 'archived' as Filter, label: 'Archived', badge: archivedCount }] : []),
  ];

  return (
    <>
      <GestureHandlerRootView style={[S.root, { backgroundColor: ios.systemBackground, paddingTop: topPad }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} animated />

        <View style={S.header}>
          <View style={S.headerInner}>
            <View style={S.menuList}>
              <Pressable
                style={S.newBtn}
                onPress={() => setNewChatVisible(true)}
                accessibilityLabel="New message"
              >
                <Glass
                  variant="regular"
                  interactive
                  radius={30}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                  fallbackIntensity={40}
                  fallbackTint={isDark ? Colors.overlayLight : Colors.border}
                />
                <HugeiconsIcon icon={PlusSignIcon} size={23} color={textColor} />
              </Pressable>

              <NetworkStatus />

              {/* Two real controls, not decoration. The right-hand pill used to
                  hold a bell glyph and an SF Symbol with no press handler at
                  all, on `Colors.overlay` — a 30%-black wash that reads as a
                  dark red smear over the app's green. */}
              <View style={[S.menuListContent, {borderWidth: 1, borderColor: ios.opaqueSeparator}]}>
                <Glass
                  variant="regular"
                  interactive
                  radius={30}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                  // fallbackIntensity={40}
                  // fallbackTint={isDark ? Colors.overlayLight : Colors.border}
                  fallbackIntensity={40}
                  fallbackTint={ios.tertiarySystemFill}
                />

                <Pressable
                  onPress={() => router.push('/chat/starred')}
                  hitSlop={8}
                  accessibilityLabel="Starred messages"
                >
                  <HugeiconsIcon icon={StarIcon} size={23} color={textColor} />
                </Pressable>

                <Pressable
                  onPress={() => router.push('/chat/wallpaper')}
                  hitSlop={8}
                  accessibilityLabel="Chat wallpaper"
                >
                  <HugeiconsIcon icon={PaintBoardIcon} size={23} color={textColor} />
                </Pressable>
              </View>
            </View>

            <View style={{ alignSelf:'flex-start' }}>
              <Text style={[S.headerTitle, { color: textColor }]}>Messages</Text>
            </View>
          </View>

          <View style={[S.headerSearch]}>
            <IOSSearchBar
              value={query}
              onChangeText={setQuery}
              onCancel={() => setQuery('')}
              placeholder="Search chats, names or @username"
            />
          </View>

          <View style={S.filterRow}>
            {filters.map((f) => {
              const on = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => { Haptics.selectionAsync(); setFilter(f.key); }}
                  style={[
                    S.filterChip,
                    { backgroundColor: on ? ios.tint : ios.tertiarySystemFill },
                  ]}
                >
                  <Text style={[S.filterText, { color: on ? '#fff' : ios.secondaryLabel }]}>
                    {f.label}{f.badge ? ` ${f.badge}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListFooterComponent={
            query.trim().length >= 2 ? (
              <NewContactResults
                hits={remoteHits}
                searching={remoteSearching}
                query={query.trim()}
                onPick={openWithCandidate}
              />
            ) : null
          }
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          renderItem={({ item }) => (
            <ConvItem
              item={item}
              query={query.trim()}
              onPress={() => open(item)}
              onDelete={() => confirmDelete(item.id)}
              onPin={() => setPrefs(item.id, { pinned: !item.pinned })}
              onMute={() => askMute(item)}
              onArchive={() => setPrefs(item.id, { archived: !item.archived })}
              onToggleRead={() =>
                (item.unread_count ?? 0) > 0 ? markRead(item.id) : markUnread(item.id)
              }
            />
          )}

          ListEmptyComponent={
            <View style={S.emptyState}>
              <View style={S.emptyIconBg}>
                <HugeiconsIcon icon={Chat} size={45}  color={subTextColor}/>
              </View>
              <Text style={[S.emptyTitle,{color: subTextColor}]}>
                {filter === 'unread'
                  ? 'Nothing unread'
                  : filter === 'archived'
                    ? 'No archived chats'
                    : query.trim()
                      ? 'No chat matches that'
                      : 'No messages yet!'}
              </Text>
              {filter === 'all' && !query.trim() ? (
                <Text style={[S.emptySubtitle, { color: subTextColor }]}>
                  Tap + to find someone by username and start a conversation.
                </Text>
              ) : null}
            </View>
          }
        />
      </GestureHandlerRootView>

      <NewChatModal
        visible={newChatVisible}
        onClose={() => setNewChatVisible(false)}
        isDark={isDark}
      />
    </>
  );
}

// ─── Stylesheet ───────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  // ── New-message sheet ──
  newBody:         { flex: 1 },
  newResults:      { flex: 1 },
  // `justifyContent: flex-end` is what pins a short result list to the bottom
  // of its space, right above the field, instead of leaving it stranded at the
  // top of an otherwise empty sheet.
  newResultsInner: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 20 },
  newEmpty:        { alignItems: 'center', gap: 8, paddingVertical: 36, paddingHorizontal: 16 },
  newEmptyTitle:   { fontFamily: 'Poppins_600SemiBold', fontSize: 16, textAlign: 'center' },
  newEmptyText:    { fontFamily: 'Poppins_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  newDock:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6, borderTopWidth: StyleSheet.hairlineWidth },
  newDockBtn:      { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  root:    { flex: 1 },

  header:      { flexDirection: 'column', justifyContent: 'space-between', paddingHorizontal: 13, paddingBottom: 14 },
  headerInner: { justifyContent: 'space-between', gap: 0},
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 24 },
  newBtn: { width: 40, height: 40, borderRadius: 50, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },

  menuList: {
    padding: 3,
    flexDirection: "row",
    alignItems: "center", 
    justifyContent: 'space-between',
    gap:15,
  },

  // No `backgroundColor` here. It used to be `Colors.overlay` — 30% black —
  // stacked under a Glass layer, which over the app's green header read as a
  // dark red wash. Glass supplies the material; a solid tint underneath it is
  // what makes glass look like a stain.
  menuListContent: {
    borderRadius: 30,
    paddingVertical: 9,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    overflow: "hidden",
  },

  filterRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  filterText: { fontFamily: "Poppins_500Medium", fontSize: 12.5 },

  headerSearch: { marginTop: 16 },

  convItem:     { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  convText:     { flex: 1, gap: 2 },
  convTopRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 5 },
  convName:       { fontFamily: 'Poppins_600SemiBold', fontSize: 15, flex: 1 },
  convNameUnread: { fontFamily: 'Poppins_700Bold' },

  newSectionTitle: {
    fontFamily: 'Poppins_600SemiBold', fontSize: 11, letterSpacing: 0.6,
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6,
  },
  newSectionSpinner: { paddingVertical: 22, alignItems: 'center' },
  newSectionEmpty:   { paddingVertical: 22, paddingHorizontal: 32 },
  newSectionEmptyText: { fontFamily: 'Poppins_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  newContactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  newContactName:   { fontFamily: 'Poppins_600SemiBold', fontSize: 15 },
  newContactMeta:   { fontFamily: 'Poppins_400Regular', fontSize: 12 },
  newContactRating: { fontFamily: 'Poppins_500Medium', fontSize: 12 },

  convLastUnread: { fontFamily: 'Poppins_500Medium' },
  convTime:     { fontFamily: 'Poppins_400Regular', fontSize: 11 },
  convBottomRow:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  convLast:     { fontFamily: 'Poppins_400Regular', fontSize: 13, flex: 1 },
  convDriverId: { fontFamily: 'Poppins_400Regular', fontSize: 11, marginTop: 1 },

  // Small badge overlaid on avatar for direct conversations
  directBadge: { position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },

  // Empty state
  emptyState: {
    alignItems: "center",
    alignSelf: 'center',
    justifyContent: 'flex-start',
    paddingTop: 250,
    paddingHorizontal: 40,
    flex: 1,
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontFamily: "Poppins_500Medium",
    fontSize: 15,
    color: Colors.text,
    textAlign: "center",
  },
  emptySubtitle: {
    fontFamily: "Poppins_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    // lineHeight: 10,
    paddingVertical: 15
  },

  // New-chat sheet
  newInputRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 50, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1 },
  newInput:      { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 15, padding: 0, letterSpacing: 1 },

  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionName: { fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  suggestionMeta: { fontFamily: 'Poppins_400Regular', fontSize: 12, marginTop: 1 },
  suggestionRole: { fontFamily: 'Poppins_500Medium', fontSize: 11, textTransform: 'capitalize' },
  driverError:   { fontFamily: 'Poppins_400Regular', fontSize: 12, lineHeight: 18, marginTop: -6 },

});