// app/emergency/index.tsx
//
// Every emergency contact, in full.
//
// ── Why this is a screen and not a settings row ────────────────────────────
// It used to be a row in Settings → Privacy that opened a sheet with two fields
// and held exactly ONE contact, in AsyncStorage, on one device. A person's
// safety net is not a preference: it has an order, per-person rules, a consent
// state that someone else controls, and a history of what was actually sent.
// None of that fits behind a disclosure chevron.
//
// ── What the list is telling you ───────────────────────────────────────────
// The status pill is the whole point of the screen. A contact who has not
// accepted will NOT receive routine trip updates — only an SOS — and showing a
// green tick before they have agreed would be the single most dangerous lie
// this app could tell. So "Waiting" is loud, and the row explains what it means
// rather than making the user infer it.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";

import {
  IOSScreen,
  IOSListSection,
  IOSListRow,
  IOSButton,
  iosAlert,
  iosActionSheet,
  useIOSTheme,
  IOSAppFont,
  SwipeableRow,
} from "@/components/ios";
import Avatar from "@/components/Avatar";
import { useAuthStore } from "@/src/store/useStore";
import * as EC from "@/src/services/emergencyContacts";
import ContactPickerSheet from "@/components/emergency/ContactPickerSheet";
import ContactEditorSheet from "@/components/emergency/ContactEditorSheet";


// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ contact }: { contact: EC.EmergencyContact }) {
  const t = useIOSTheme();

  const [label, colour, bg] =
    contact.status === "verified"
      ? ["Confirmed", t.systemGreen, `${t.systemGreen}1F`]
      : contact.status === "declined"
        ? ["Declined", t.systemRed, `${t.systemRed}1F`]
        : ["Waiting", t.systemOrange, `${t.systemOrange}1F`];

  return (
    <View style={[S.pill, { backgroundColor: bg }]}>
      <Text style={[S.pillText, { color: colour }]}>{label}</Text>
    </View>
  );
}

/** One line saying what this contact will and will not be told. */
function summarise(c: EC.EmergencyContact): string {
  if (c.status !== "verified") {
    return c.contact_user_id
      ? "They hasn't accepted yet and will only get text"
      : "This contact is Not on EMILGO and will only get a text, from their phone";
  }
  const on: string[] = [];
  if (c.notify_trip_start) on.push("trip start");
  if (c.notify_trip_end) on.push("arrival");
  if (c.notify_route_deviation) on.push("route changes");
  if (c.notify_no_movement) on.push("long stops");
  if (!on.length) return c.notify_sos ? "SOS only" : "Nothing — every alert is off";

  const muted =
    c.muted_until && new Date(c.muted_until) > new Date()
      ? " · muted"
      : "";
  return `${on.join(", ")}${c.share_live_location ? " · live location" : ""}${muted}`;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function EmergencyContactsScreen() {
  const t = useIOSTheme();
  const user = useAuthStore((s) => s.user);

  const [contacts, setContacts] = useState<EC.EmergencyContact[]>([]);
  const [requests, setRequests] = useState<EC.ECRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<EC.EmergencyContact | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const [rows, reqs] = await Promise.all([EC.list(), EC.requestsForMe()]);
    setContacts(rows);
    setRequests(reqs.filter((r) => r.status === "pending"));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Re-read on focus: the editor sheet and the picker both write, and coming
  // back to a stale list is how a user ends up adding the same person twice.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const verified = useMemo(() => contacts.filter((c) => c.status === "verified").length, [contacts]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const confirmDelete = useCallback((c: EC.EmergencyContact) => {
    iosAlert(
      `Remove ${c.name}?`,
      "They'll stop receiving your trip updates and won't be alerted if you use SOS.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const ok = await EC.remove(c.id);
            if (ok) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setContacts((prev) => prev.filter((x) => x.id !== c.id));
            } else {
              iosAlert("Couldn't remove", "Please try again.");
            }
          },
        },
      ],
    );
  }, []);

  /** Move a contact to the top of the order an SOS walks. */
  const makeFirst = useCallback(async (c: EC.EmergencyContact) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const ids = [c.id, ...contacts.filter((x) => x.id !== c.id).map((x) => x.id)];
    setContacts((prev) => {
      const moved = prev.find((x) => x.id === c.id)!;
      return [moved, ...prev.filter((x) => x.id !== c.id)];
    });
    await EC.reorder(ids);
  }, [contacts]);

  const muteFor = useCallback(async (c: EC.EmergencyContact, hours: number | null) => {
    await EC.update(c.id, hours == null
      ? { clearMute: true }
      : { mutedUntil: new Date(Date.now() + hours * 3600_000).toISOString() });
    load();
  }, [load]);

  /**
   * Send a real test alert.
   *
   * Nothing else on this screen proves the thing works. A contact who has never
   * seen one of these will treat the real thing as spam, so letting the user
   * fire a harmless one is worth more than any amount of explanatory copy.
   */
  const sendTest = useCallback(async () => {
    if (testing) return;
    setTesting(true);
    try {
      const name = user?.full_name || "Your contact";
      const { title, body } = EC.messageFor("test", { name });
      const unreachable = await EC.dispatch({ kind: "test", title, body });

      if (!unreachable.length) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        iosAlert("Test sent", "Everyone on your list who uses EMILGO just got a test alert.");
        return;
      }

      // Honest about the split: some were reached by the server, the rest need
      // the user to press send in their own messaging app.
      iosAlert(
        "Send the rest from your phone",
        `${unreachable.length} of your contacts aren't on EMILGO, so the test has to go from your own number. Open the composer for each one?`,
        [
          { text: "Not now", style: "cancel" },
          {
            text: "Open",
            onPress: async () => {
              for (const c of unreachable) {
                await EC.openComposer(c, body);
              }
            },
          },
        ],
      );
    } finally {
      setTesting(false);
    }
  }, [testing, user?.full_name]);

  const rowMenu = useCallback((c: EC.EmergencyContact) => {
    const muted = !!c.muted_until && new Date(c.muted_until) > new Date();
    iosActionSheet(c.name, c.phone, [
      { text: "Edit contact and alerts", onPress: () => setEditing(c) },
      ...(contacts[0]?.id !== c.id
        ? [{ text: "Make first to be alerted", onPress: () => makeFirst(c) }]
        : []),
      muted
        ? { text: "Unmute", onPress: () => muteFor(c, null) }
        : { text: "Mute for 8 hours", onPress: () => muteFor(c, 8) },
      { text: "Remove", style: "destructive" as const, onPress: () => confirmDelete(c) },
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [contacts, makeFirst, muteFor, confirmDelete]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <IOSScreen title="Emergency contacts" back>
        <View style={S.centre}><ActivityIndicator color={t.tint} /></View>
      </IOSScreen>
    );
  }

  return (
    <IOSScreen
      title="Emergency contacts"
      subtitle={
        contacts.length
          ? `${contacts.length} of ${EC.MAX_CONTACTS} · ${verified} confirmed`
          : undefined
      }
      back
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.tint} />
      }
    >
      {/* Requests addressed to ME. At the top because someone else is waiting
          on an answer, and burying it under my own list means they wait. */}
      {requests.length > 0 && (
        <IOSListSection
          header="Someone added you"
          footer="They'll be able to see your name on their list. You can change your mind at any time."
        >
          {requests.map((r) => (
            <IOSListRow
              key={r.id}
              label={r.owner_name || "An EMILGO user"}
              detail={r.relationship ? `Added you as their ${r.relationship}` : "Added you as an emergency contact"}
              icon={<Avatar name={r.owner_name || "User"} photoUri={r.owner_photo ?? undefined} size={30} />}
              accessory={{ type: "none" }}
              onPress={() =>
                iosActionSheet(
                  `${r.owner_name || "This person"} added you as an emergency contact`,
                  "If you accept, you'll be told when their trips start and end, and immediately if they use SOS.",
                  [
                    {
                      text: "Accept",
                      onPress: async () => {
                        await EC.respond(r.id, true);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        load();
                      },
                    },
                    {
                      text: "Decline",
                      style: "destructive",
                      onPress: async () => { await EC.respond(r.id, false); load(); },
                    },
                    { text: "Cancel", style: "cancel" },
                  ],
                )
              }
            />
          ))}
        </IOSListSection>
      )}

      {contacts.length === 0 ? (
        <View style={S.empty}>
          <View style={[S.emptyIcon,
            // { backgroundColor: `${t.systemRed}14` }
          ]}>
            {/* <Text style={S.emptyGlyph}>🆘</Text>
            <HugeiconsIcon icon={CapcutIcon} size={20} color={t.label} /> */}
          </View>
          <Text style={[S.emptyTitle, { color: t.label }]}>Nobody knows where you are</Text>
          <Text style={[S.emptyBody, { color: t.tertiaryLabel }]}>
            Add someone you trust. They&rsquo;ll be told when your trip starts and end.
          </Text>
          <IOSButton 
            title="Add new contact" 
            onPress={() => setPickerOpen(true)}
            style={{ alignSelf: 'center' }}
          />
        </View>
      ) : (
        <IOSListSection
          header="Your contacts"
          footer={
            contacts.length >= EC.MAX_CONTACTS
              ? `That's the maximum of ${EC.MAX_CONTACTS}. Remove one to add another.`
              : "In an emergency they're alerted in this order. Swipe a row to edit or remove."
          }
        >
            {contacts.map((c) => (
            <>
              <SwipeableRow
                key={c.id}
                style={{padding: 0, margin: 0,backgroundColor: t.secondarySystemBackground}}
                actions={[
                  { key: "edit", label: "Edit", symbol: "pencil", color: t.tint, onPress: () => setEditing(c) },
                  {
                    key: "delete", label: "Remove", symbol: "trash.fill",
                    color: t.systemRed, destructive: true, onPress: () => confirmDelete(c),
                  },
                ]}
              >
                <View style={{backgroundColor: t.secondarySystemBackground}}>
                  <IOSListRow
                    label={c.name}
                    detail={summarise(c)}
                    icon={<Avatar name={c.name} size={40} />}
                    accessory={{ type: "none" }}
                    onPress={() => rowMenu(c)}
                  />
                </View>
                {/* The pill sits over the row rather than inside it: IOSListRow
                    owns its own layout, and a second right-hand slot would fight
                    the accessory it already reserves space for. */}
                <View style={S.pillHost} pointerEvents="none">
                  <StatusPill contact={c} />
                </View>
              </SwipeableRow>
            </>
          ))}
        </IOSListSection>
      )}

      {contacts.length > 0 && contacts.length < EC.MAX_CONTACTS && (
        <IOSListSection>
          <IOSListRow
            label="Add a contact"
            symbol="person.badge.plus"
            symbolColor={t.tint}
            accessory={{ type: "disclosure" }}
            onPress={() => setPickerOpen(true)}
          />
        </IOSListSection>
      )}

      {contacts.length > 0 && (
        <IOSListSection
          header="Check it works"
          footer="A test alert is clearly labelled as a test. It's the only way to know your contacts will recognise the real thing."
        >
          <IOSListRow
            label={testing ? "Sending…" : "Send a test alert"}
            symbol="bell.badge"
            symbolColor={t.systemOrange}
            accessory={{ type: "disclosure" }}
            disabled={testing}
            onPress={sendTest}
          />
          <IOSListRow
            label="What was sent"
            detail="Every alert, and every one deliberately held back"
            symbol="list.bullet.rectangle"
            accessory={{ type: "disclosure" }}
            onPress={() => router.push("/emergency/history")}
          />
        </IOSListSection>
      )}

      <ContactPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdded={() => { setPickerOpen(false); load(); }}
        existing={contacts}
      />

      <ContactEditorSheet
        contact={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </IOSScreen>
  );
}

const S = StyleSheet.create({
  centre: { paddingVertical: 60, alignItems: "center" },

  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  pillText: { ...IOSAppFont.caption2, fontFamily: "Poppins_600SemiBold" },
  pillHost: { position: "absolute", right: 3, top: 0, bottom: 60, justifyContent: "center"},

  empty: { alignItems: "center", paddingHorizontal: 32, paddingTop: 40, gap: 12, marginVertical: 50, flex: 1 },
  emptyIcon: {
    width: 72,
    height: 72, 
    borderRadius: 24,
    alignItems: "center", 
    justifyContent: "center", 
    margin:'auto', 
  },
  emptyGlyph: { fontSize: 32 },
  emptyTitle: { ...IOSAppFont.headline, textAlign: "center" },
  emptyBody: { ...IOSAppFont.subheadline, textAlign: "center", lineHeight: 21, marginBottom: 8 },
});
