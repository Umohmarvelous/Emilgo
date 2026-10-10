// components/emergency/ContactPickerSheet.tsx
//
// Adding a contact — from the phonebook, or by hand.
//
// ── Why the phonebook comes first ──────────────────────────────────────────
// The number has to be right. A typo in an emergency contact is invisible until
// the moment it matters, and nobody proofreads a number they just typed. Picking
// from the address book removes the class of error entirely, so it is the
// default and typing is the fallback — not the other way round.
//
// ── Why permission is asked LATE ───────────────────────────────────────────
// The sheet opens on the manual field with a "Choose from contacts" button. The
// OS prompt fires when that button is pressed, so it arrives attached to an
// action the user just took rather than as an unexplained demand on open. A
// refusal costs nothing: the typing path is already on screen.

import React, { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView } from "react-native";
import * as Haptics from "expo-haptics";

import {
  IOSSheet,
  IOSButton,
  IOSSearchBar,
  iosAlert,
  useIOSTheme,
  IOSAppFont,
} from "@/components/ios";
import Avatar from "@/components/Avatar";
import * as EC from "@/src/services/emergencyContacts";

/** Common enough to be worth a tap; anything else is typed. */
const RELATIONSHIPS = ["Mother", "Father", "Spouse", "Sibling", "Child", "Friend", "Colleague"];

export interface ContactPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
  existing: EC.EmergencyContact[];
}

export default function ContactPickerSheet({
  visible, onClose, onAdded, existing,
}: ContactPickerSheetProps) {
  const t = useIOSTheme();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [book, setBook] = useState<EC.PhonebookEntry[] | null>(null);
  const [loadingBook, setLoadingBook] = useState(false);
  const [query, setQuery] = useState("");

  const reset = useCallback(() => {
    setName(""); setPhone(""); setRelationship(null);
    setBook(null); setQuery("");
  }, []);

  const close = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  const openPhonebook = useCallback(async () => {
    Haptics.selectionAsync();
    setLoadingBook(true);
    try {
      setBook(await EC.readPhonebook());
    } catch (e: any) {
      iosAlert("Contacts", e?.message ?? "Could not read your contacts.");
    } finally {
      setLoadingBook(false);
    }
  }, []);

  // Numbers already on the list, so the same person cannot be added twice from
  // the address book — the server refuses it, but showing it as unavailable is
  // better than letting someone tap and be told no.
  const taken = useMemo(
    () => new Set(existing.map((c) => c.phone.replace(/[^\d]/g, "").slice(-10))),
    [existing],
  );

  const filtered = useMemo(() => {
    if (!book) return [];
    const q = query.trim().toLowerCase();
    if (!q) return book.slice(0, 300);
    return book
      .filter((e) => e.name.toLowerCase().includes(q) || e.phone.includes(q))
      .slice(0, 300);
  }, [book, query]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await EC.add(name.trim(), phone.trim(), relationship ?? undefined);
      if (!res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        iosAlert("Couldn't add", res.message);
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Two genuinely different outcomes, and conflating them is what would
      // make someone believe a stranger's phone had been notified.
      iosAlert(
        res.reachableInApp ? "Request sent" : `${name.trim()} added`,
        res.reachableInApp
          ? `${name.trim()} uses EMILGO. They'll be asked to accept — until they do, they'll only get an SOS.`
          : `${name.trim()} isn't on EMILGO, so alerts go from your own phone. They'll still get an SOS, and you can invite them to install the app.`,
        [{ text: "Done" }],
      );
      reset();
      onAdded();
    } finally {
      setSaving(false);
    }
  }, [saving, name, phone, relationship, reset, onAdded]);

  const canSave = name.trim().length >= 2 && phone.replace(/[^\d]/g, "").length >= 10;

  return (
    <IOSSheet
      visible={visible}
      onClose={close}
      detents={[0.72, "large"]}
      title={book ? "Choose a contact" : "Add emergency contact"}
      showGrabber
      dismissible
    >
      {book ? (
        <View style={S.bookWrap}>
          <IOSSearchBar value={query} onChangeText={setQuery} placeholder="Search your contacts" />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {filtered.map((e) => {
              const already = taken.has(e.phone.replace(/[^\d]/g, "").slice(-10));
              return (
                <Pressable
                  key={e.id}
                  disabled={already}
                  style={({ pressed }) => [
                    S.bookRow,
                    { borderBottomColor: t.separator, opacity: already ? 0.4 : 1 },
                    pressed && { backgroundColor: t.tertiarySystemFill },
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setName(e.name);
                    setPhone(e.phone);
                    setBook(null);
                    setQuery("");
                  }}
                >
                  <Avatar name={e.name} size={38} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[S.bookName, { color: t.label }]} numberOfLines={1}>{e.name}</Text>
                    <Text style={[S.bookPhone, { color: t.secondaryLabel }]} numberOfLines={1}>
                      {e.phone}
                    </Text>
                  </View>
                  {already ? (
                    <Text style={[S.bookTag, { color: t.tertiaryLabel }]}>Added</Text>
                  ) : null}
                </Pressable>
              );
            })}
            {!filtered.length ? (
              <Text style={[S.bookEmpty, { color: t.tertiaryLabel }]}>
                {query ? `Nobody matching “${query}”.` : "No contacts with a phone number."}
              </Text>
            ) : null}
          </ScrollView>

          <IOSButton title="Type it instead" variant="borderless" onPress={() => setBook(null)} />
        </View>
      ) : (
        <View style={S.form}>
          <IOSButton
            title={loadingBook ? "Opening…" : "Choose from my contacts"}
            variant="tinted"
            onPress={openPhonebook}
            disabled={loadingBook}
            style={{ alignSelf: 'center' }}
            size="small"
          />
          <View style={{flexDirection:'row', alignItems:'center', justifyContent:'center', gap:9, marginVertical: 20 }}>
            <View style={{width: 90, height:1, backgroundColor:t.opaqueSeparator, borderRadius: 50}}/>
              <Text style={[S.or, { color: t.tertiaryLabel }]}>or type it manually</Text>
            <View  style={{width: 90, height:1, backgroundColor:t.opaqueSeparator, borderRadius: 50}}/>
          </View>

          <Text style={[S.label, { color: t.secondaryLabel }]}>NAME</Text>
          <TextInput
            style={[S.input, { backgroundColor: t.tertiarySystemFill, color: t.label }]}
            placeholder="e.g. Mama"
            placeholderTextColor={t.tertiaryLabel}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="next"
          />

          <Text style={[S.label, { color: t.secondaryLabel }]}>PHONE</Text>
          <TextInput
            style={[S.input, { backgroundColor: t.tertiarySystemFill, color: t.label }]}
            placeholder="0803 123 4567"
            placeholderTextColor={t.tertiaryLabel}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            returnKeyType="done"
          />
          {/* <Text style={[S.hint, { color: t.tertiaryLabel }]}>
              Nigerian numbers work in any format — 0803…, +234803… or 803…
          </Text> */}

          <Text style={[S.label, { color: t.secondaryLabel }]}>RELATIONSHIP (OPTIONAL)</Text>
          <View style={S.chips}>
            {RELATIONSHIPS.map((r) => {
              const on = relationship === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => { Haptics.selectionAsync(); setRelationship(on ? null : r); }}
                  style={[
                    S.chip,
                    { backgroundColor: on ? t.tint : t.tertiarySystemFill },
                  ]}
                >
                  <Text style={[S.chipText, { color: on ? "#fff" : t.label }]}>{r}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={S.actions}>
            <IOSButton
              title={saving ? "Adding…" : "Add contact"}
              onPress={save}
              disabled={!canSave || saving}
              variant="filled"
              fullWidth={true}
              size="large"
              style={{ backgroundColor: t.systemGreen }}
              />
          </View>
        </View>
      )}
    </IOSSheet>
  );
}

const S = StyleSheet.create({
  form: { gap: 6, paddingBottom: 20 },
  or: { ...IOSAppFont.footnote, textAlign: "center", marginVertical: 14 },
  label: { ...IOSAppFont.caption2, letterSpacing: 0.5, marginTop: 4, marginBottom: 6, paddingLeft: 4 },
  input: {
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    ...IOSAppFont.body,
  },
  hint: { ...IOSAppFont.caption1, marginTop: 6, paddingLeft: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  chipText: { ...IOSAppFont.footnote },
  actions: { marginTop: 34 },

  bookWrap: { flex: 1, gap: 10 },
  bookRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bookName: { ...IOSAppFont.body },
  bookPhone: { ...IOSAppFont.footnote },
  bookTag: { ...IOSAppFont.caption1 },
  bookEmpty: { ...IOSAppFont.footnote, textAlign: "center", paddingVertical: 40 },
});
