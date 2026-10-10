// app/coins/gift.tsx
//
// Send `cs` to a driver. Amount → confirm → sent.
//
// ── Why three stages and not one button ────────────────────────────────────
// A gift is irreversible and it is addressed to a specific person. One tap that
// both picks the amount and sends it is how people send 500 to the wrong driver.
// The confirm stage exists to put the recipient's face and name next to the
// amount, which is the only check that catches the mistake that actually
// happens.
//
// ── What this screen must never become ─────────────────────────────────────
// Read COMPLIANCE.md §2.3. This moves POINTS. There is no fee, no currency, no
// bank leg and no conversion — and if any of those are added, the feature
// becomes person-to-person money transmission and needs a CBN licence. It is
// also why the amount chips are round numbers of cs rather than "₦100 worth".

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import * as Haptics from "expo-haptics";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { GiftIcon, CheckmarkCircle02Icon, StarIcon } from "@hugeicons/core-free-icons";

import { IOSScreen, IOSButton, useIOSTheme, IOSAppFont, iosAlert } from "@/components/ios";
import Avatar from "@/components/Avatar";
import { useCoinsStore } from "@/src/store/useCoinsStore";
import { formatCs, explainGiftFailure } from "@/src/services/coins";
import { supabase } from "@/src/services/supabase";

type Stage = "amount" | "confirm" | "done";

/** Presets. Round cs values — never "the equivalent of" anything. */
const CHIPS = [10, 25, 50, 100, 200];

export default function GiftCoinsScreen() {
  const { userId, name, photo, role } = useLocalSearchParams<{
    userId?: string;
    name?: string;
    photo?: string;
    role?: string;
  }>();

  const t = useIOSTheme();
  const balance = useCoinsStore((s) => s.balance);
  const giftConfig = useCoinsStore((s) => s.giftConfig);
  const refresh = useCoinsStore((s) => s.refresh);
  const gift = useCoinsStore((s) => s.gift);

  const [stage, setStage] = useState<Stage>("amount");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  // The recipient may arrive as params (from a chat or a trip) or have to be
  // looked up (from a deep link). Params first, so the screen paints with the
  // right face on frame one.
  const [person, setPerson] = useState<{
    id: string; name: string; photo?: string; role?: string;
  } | null>(userId ? { id: userId, name: name || "Driver", photo, role } : null);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    if (person?.name && person.name !== "Driver") return;
    let alive = true;
    supabase
      .rpc("get_driver_public", { p_driver_id: userId })
      .then(({ data }) => {
        const d = Array.isArray(data) ? data[0] : data;
        if (alive && d) {
          setPerson({
            id: d.id,
            name: d.full_name || "Driver",
            photo: d.profile_photo ?? undefined,
            role: d.role ?? undefined,
          });
        }
      });
    return () => { alive = false; };
  }, [userId, person?.name]);

  const min = giftConfig?.min_gift ?? 5;
  const max = giftConfig?.max_gift ?? 500;
  const n = parseInt(amount.replace(/\D/g, ""), 10) || 0;

  /** One sentence naming the ONE reason this cannot be sent yet. */
  const problem = useMemo(() => {
    if (!person?.id) return "Pick someone to send coins to.";
    if (n === 0) return null;
    if (n < min) return `The smallest gift is ${formatCs(min)}.`;
    if (n > max) return `The largest gift is ${formatCs(max)}.`;
    if (n > balance) return `You only have ${formatCs(balance)}.`;
    return null;
  }, [n, min, max, balance, person?.id]);

  const canContinue = !!person?.id && n >= min && n <= max && n <= balance;

  const send = useCallback(async () => {
    if (!person?.id || sending) return;
    setSending(true);
    try {
      const res = await gift(person.id, n, note);
      if (!res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        iosAlert("Not sent", explainGiftFailure(res));
        setStage("amount");
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReference(res.reference);
      setStage("done");
    } finally {
      setSending(false);
    }
  }, [person?.id, n, note, gift, sending]);

  // ── Sent ────────────────────────────────────────────────────────────────
  if (stage === "done") {
    return (
      <IOSScreen title="Sent" tabBarInset={false}>
        <View style={styles.doneWrap}>
          <View style={[styles.doneRing, { borderColor: t.tint + "33" }]}>
            <View style={[styles.doneDot, { backgroundColor: t.tint }]}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={36} color="#fff" strokeWidth={2} />
            </View>
          </View>

          <Text style={[styles.doneAmount, { color: t.label }]}>{formatCs(n)}</Text>
          <Text style={[styles.doneTo, { color: t.secondaryLabel }]}>
            sent to {person?.name}
          </Text>

          {note.trim() ? (
            <Text style={[styles.doneNote, { color: t.tertiaryLabel }]}>“{note.trim()}”</Text>
          ) : null}

          <View style={[styles.receipt, { backgroundColor: t.secondarySystemGroupedBackground }]}>
            <Row label="New balance" value={formatCs(balance)} t={t} />
            <Row label="Reference" value={(reference ?? "").slice(-12) || "—"} t={t} mono />
            <Row label="When" value={new Date().toLocaleString()} t={t} />
          </View>

          {/* Stated plainly, because this is the sentence that keeps the feature
              on the right side of the line — and the user should know it too. */}
          <Text style={[styles.legal, { color: t.tertiaryLabel }]}>
            Coins are a reward inside EMILGO. They have no cash value and cannot
            be withdrawn or exchanged for money.
          </Text>

          <View style={styles.doneActions}>
            <IOSButton
              title="View my coins"
              variant="tinted"
              fullWidth
              onPress={() => router.replace("/coins")}
            />
            <IOSButton title="Done" fullWidth onPress={() => router.back()} />
          </View>
        </View>
      </IOSScreen>
    );
  }

  // ── Confirm ─────────────────────────────────────────────────────────────
  if (stage === "confirm") {
    return (
      <IOSScreen title="Confirm" back onBack={() => setStage("amount")} tabBarInset={false}>
        <View style={styles.confirmWrap}>
          <Avatar name={person?.name || "Driver"} photoUri={person?.photo} size={78} />
          <Text style={[styles.confirmName, { color: t.label }]}>{person?.name}</Text>
          {person?.role ? (
            <Text style={[styles.confirmRole, { color: t.tertiaryLabel }]}>{person.role}</Text>
          ) : null}

          <Text style={[styles.confirmAmount, { color: t.tint }]}>{formatCs(n)}</Text>

          {note.trim() ? (
            <Text style={[styles.confirmNote, { color: t.secondaryLabel }]}>“{note.trim()}”</Text>
          ) : null}

          <View style={[styles.receipt, { backgroundColor: t.secondarySystemGroupedBackground }]}>
            <Row label="Your balance now" value={formatCs(balance)} t={t} />
            <Row label="After this gift" value={formatCs(balance - n)} t={t} strong />
          </View>

          <Text style={[styles.legal, { color: t.tertiaryLabel }]}>
            This cannot be undone. Coins have no cash value.
          </Text>

          <IOSButton
            title={sending ? "Sending…" : `Send ${formatCs(n)}`}
            onPress={send}
            disabled={sending}
            loading={sending}
            fullWidth
          />
        </View>
      </IOSScreen>
    );
  }

  // ── Amount ──────────────────────────────────────────────────────────────
  return (
    <IOSScreen title="Gift coins" back tabBarInset={false} scrollable={false}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.recipient, { backgroundColor: t.secondarySystemGroupedBackground }]}>
          <Avatar name={person?.name || "Driver"} photoUri={person?.photo} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.recipientName, { color: t.label }]} numberOfLines={1}>
              {person?.name || "Choose a driver"}
            </Text>
            <Text style={[styles.recipientMeta, { color: t.tertiaryLabel }]} numberOfLines={1}>
              {person?.role === "driver" ? "Driver" : person?.role || "Recipient"}
            </Text>
          </View>
          <HugeiconsIcon icon={GiftIcon} size={22} color={t.tint} />
        </View>

        <View style={[styles.balanceCard, { backgroundColor: t.tint + "14" }]}>
          <HugeiconsIcon icon={StarIcon} size={20} color={t.tint} />
          <Text style={[styles.balanceText, { color: t.tint }]}>
            You have {formatCs(balance)}
          </Text>
        </View>

        <Text style={[styles.section, { color: t.tertiaryLabel }]}>AMOUNT</Text>

        <View style={[styles.amountBox, { backgroundColor: t.secondarySystemGroupedBackground }]}>
          <TextInput
            style={[styles.amountInput, { color: t.label }]}
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/\D/g, "").slice(0, 5))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={t.quaternaryLabel}
            maxLength={5}
          />
          <Text style={[styles.amountUnit, { color: t.secondaryLabel }]}>{Math.abs(n) === 1 ? "coin" : "coins"}</Text>
        </View>

        <View style={styles.chips}>
          {CHIPS.map((c) => {
            const affordable = c <= balance;
            const on = n === c;
            return (
              <Pressable
                key={c}
                onPress={() => { Haptics.selectionAsync(); setAmount(String(c)); }}
                disabled={!affordable}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? t.tint : t.tertiarySystemFill,
                    opacity: affordable ? 1 : 0.35,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: on ? "#fff" : t.label }]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>

        {problem ? (
          <Text style={[styles.problem, { color: t.systemRed }]}>{problem}</Text>
        ) : null}

        <Text style={[styles.section, { color: t.tertiaryLabel }]}>MESSAGE (OPTIONAL)</Text>
        <TextInput
          style={[
            styles.note,
            { backgroundColor: t.secondarySystemGroupedBackground, color: t.label },
          ]}
          value={note}
          onChangeText={setNote}
          placeholder="Thanks for the ride"
          placeholderTextColor={t.quaternaryLabel}
          maxLength={120}
          multiline
        />

        <Text style={[styles.legal, { color: t.tertiaryLabel, textAlign: "left" }]}>
          Coins are an in-app reward. They have no cash value, cannot be withdrawn,
          and cannot be exchanged for money — inside EMILGO or anywhere else.
        </Text>

        <IOSButton
          title="Continue"
          fullWidth
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStage("confirm"); }}
          disabled={!canContinue}
        />
        <View style={{ height: 30 }} />
      </ScrollView>
    </IOSScreen>
  );
}

function Row({
  label, value, t, strong, mono,
}: { label: string; value: string; t: any; strong?: boolean; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: t.secondaryLabel }]}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          { color: strong ? t.label : t.secondaryLabel },
          strong && { fontFamily: "Poppins_600SemiBold" },
          mono && { fontVariant: ["tabular-nums"] },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, gap: 10 },

  recipient: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 16,
  },
  recipientName: { ...IOSAppFont.headline },
  recipientMeta: { ...IOSAppFont.caption1, textTransform: "capitalize", marginTop: 1 },

  balanceCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
  },
  balanceText: { ...IOSAppFont.subheadline, fontFamily: "Poppins_500Medium" },

  section: { ...IOSAppFont.caption1, letterSpacing: 0.6, marginTop: 12, marginBottom: 2 },

  amountBox: {
    flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 6,
    borderRadius: 16, paddingVertical: 18,
  },
  amountInput: {
    fontFamily: "Poppins_700Bold", fontSize: 44, padding: 0,
    minWidth: 90, textAlign: "right",
  },
  amountUnit: { fontFamily: "Poppins_600SemiBold", fontSize: 20 },

  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { flex: 1, minWidth: 56, paddingVertical: 10, borderRadius: 12, alignItems: "center" },
  chipText: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },

  problem: { ...IOSAppFont.caption1, marginTop: 2 },

  note: {
    borderRadius: 14, padding: 14, minHeight: 76,
    ...IOSAppFont.subheadline, textAlignVertical: "top",
  },

  legal: { ...IOSAppFont.caption2, lineHeight: 16, textAlign: "center", marginVertical: 12 },

  confirmWrap: { alignItems: "center", paddingHorizontal: 24, gap: 6, paddingTop: 12 },
  confirmName: { ...IOSAppFont.title3, marginTop: 10 },
  confirmRole: { ...IOSAppFont.caption1, textTransform: "capitalize" },
  confirmAmount: { fontFamily: "Poppins_700Bold", fontSize: 42, marginVertical: 14 },
  confirmNote: { ...IOSAppFont.subheadline, fontStyle: "italic", textAlign: "center" },

  receipt: { alignSelf: "stretch", borderRadius: 14, padding: 14, gap: 8, marginTop: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { ...IOSAppFont.subheadline },
  rowValue: { ...IOSAppFont.subheadline },

  doneWrap: { alignItems: "center", paddingHorizontal: 24, paddingTop: 24, gap: 4 },
  doneRing: {
    width: 104, height: 104, borderRadius: 52, borderWidth: 8,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  doneDot: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  doneAmount: { fontFamily: "Poppins_700Bold", fontSize: 34 },
  doneTo: { ...IOSAppFont.subheadline },
  doneNote: { ...IOSAppFont.subheadline, fontStyle: "italic", marginTop: 8, textAlign: "center" },
  doneActions: { alignSelf: "stretch", gap: 10, marginTop: 6 },
});
