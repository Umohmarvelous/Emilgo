// components/admin/BillboardReviews.tsx
//
// The Ad console's billboard review queue (games/emilgo-games/SPEC-V3.md §8).
// Every billboard an advertiser submits waits here, off the air, until a person
// approves it. Approving needs every content rule ticked; the database refuses
// it otherwise, and refuses an unpaid self-serve one, and a second premium
// booking on a board that's already held (review_billboard_ad).
//
// The keyword screen's flags are shown first: they ask for a second look and
// decide nothing.

import React from "react";
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, Switch, Image, Linking } from "react-native";
import * as Haptics from "expo-haptics";

import { useIOSTheme, IOSAppFont, iosAlert, IOSSegmentedTabs } from "@/components/ios";
import { BILLBOARD_RULES, MAP_NAMES, listReviews, reviewBillboard, type BillboardReview } from "@/src/services/billboards";

type Status = "pending" | "approved" | "rejected";

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

function Review({ r, onDone }: { r: BillboardReview; onDone: () => void }) {
  const t = useIOSTheme();
  const [rules, setRules] = React.useState<string[]>(r.review_rules ?? []);
  const [notes, setNotes] = React.useState(r.review_notes ?? "");
  const [busy, setBusy] = React.useState(false);
  const pictures = r.board_format === "slideshow" ? r.slides : r.board_format === "video" ? (r.poster_url ? [r.poster_url] : []) : r.media_url ? [r.media_url] : [];

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await reviewBillboard(r.id, approve, notes, rules);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      iosAlert(approve ? "Couldn't approve" : "Couldn't reject", e?.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: t.secondarySystemGroupedBackground }]}>
      <Text style={[styles.title, { color: t.label }]} numberOfLines={2}>
        {r.headline}
      </Text>
      <Text style={[styles.sub, { color: t.tertiaryLabel }]}>
        {[r.partner_name ?? "No partner", `paid ${naira(r.paid_naira)}`, `budget ${naira(r.budget_naira)}`].join(" · ")}
      </Text>
      <Text style={[styles.sub, { color: t.tertiaryLabel }]}>
        {[
          r.board_format,
          r.maps.length ? r.maps.map((m) => MAP_NAMES[m] ?? m).join(", ") : "every map",
          r.static_premium ? `premium: ${r.slot_ids.join(", ")}` : r.slot_ids.length ? `boards: ${r.slot_ids.join(", ")}` : "rotation",
          r.cycle_s ? `${r.cycle_s} s` : "whole match",
          r.audio ? "film sound allowed" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {r.content_flags.length ? (
        <Text style={[styles.flags, { color: t.systemOrange }]}>Look twice: {r.content_flags.join(", ")}</Text>
      ) : null}
      <View style={styles.thumbs}>
        {pictures.map((u) => (
          <Image key={u} source={{ uri: u }} style={styles.thumb} />
        ))}
      </View>
      {r.board_format === "video" && r.media_url ? (
        <Pressable onPress={() => Linking.openURL(r.media_url!)}>
          <Text style={[styles.link, { color: t.tint }]}>Watch the film</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => Linking.openURL(r.cta_url)}>
        <Text style={[styles.link, { color: t.tint }]} numberOfLines={1}>
          {r.cta_url}
        </Text>
      </Pressable>

      {r.review_status === "pending" ? (
        <>
          {BILLBOARD_RULES.map((rule) => (
            <View key={rule.id} style={styles.ruleRow}>
              <Text style={[styles.rule, { color: t.label }]}>{rule.label}</Text>
              <Switch value={rules.includes(rule.id)} onValueChange={(v) => setRules((x) => (v ? [...x, rule.id] : x.filter((y) => y !== rule.id)))} />
            </View>
          ))}
          <TextInput
            style={[styles.input, { backgroundColor: t.tertiarySystemFill, color: t.label }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes for the advertiser (say why, if you reject it)"
            placeholderTextColor={t.tertiaryLabel}
            multiline
          />
          <View style={styles.actions}>
            <Pressable disabled={busy} onPress={() => decide(false)} style={styles.secondaryBtn}>
              <Text style={[styles.secondaryText, { color: t.systemRed }]}>Reject</Text>
            </Pressable>
            <Pressable
              disabled={busy || rules.length < BILLBOARD_RULES.length}
              onPress={() => decide(true)}
              style={[styles.primaryBtn, { backgroundColor: t.tint, opacity: rules.length < BILLBOARD_RULES.length ? 0.5 : 1 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Approve</Text>}
            </Pressable>
          </View>
        </>
      ) : r.review_notes ? (
        <Text style={[styles.sub, { color: t.secondaryLabel }]}>{r.review_notes}</Text>
      ) : null}
    </View>
  );
}

export function BillboardReviews() {
  const t = useIOSTheme();
  const [status, setStatus] = React.useState<Status>("pending");
  const [rows, setRows] = React.useState<BillboardReview[] | null>(null);

  const load = React.useCallback(async () => {
    try {
      setRows(await listReviews(status));
    } catch (e: any) {
      setRows([]);
      iosAlert("Couldn't load the queue", e?.message ?? "Please try again.");
    }
  }, [status]);

  React.useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  return (
    <View>
      <View style={styles.tabs}>
        <IOSSegmentedTabs<Status>
          segments={[
            { key: "pending", label: "Waiting" },
            { key: "approved", label: "Approved" },
            { key: "rejected", label: "Rejected" },
          ]}
          active={status}
          onChange={setStatus}
          variant="underline"
        />
      </View>
      {rows === null ? <ActivityIndicator color={t.tint} style={{ marginTop: 24 }} /> : null}
      {rows?.map((r) => <Review key={r.id} r={r} onDone={load} />)}
      {rows && !rows.length ? (
        <Text style={[styles.empty, { color: t.secondaryLabel }]}>
          {status === "pending" ? "Nothing waiting. Billboards from the advertiser portal (/advertise) land here." : "None yet."}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 16, paddingBottom: 10 },
  card: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14, gap: 6 },
  title: { ...IOSAppFont.body, fontFamily: "Poppins_600SemiBold" },
  sub: { ...IOSAppFont.caption1 },
  flags: { ...IOSAppFont.caption1, fontFamily: "Poppins_600SemiBold" },
  link: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  thumb: { width: 160, height: 80, borderRadius: 6, backgroundColor: "#111" },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  rule: { ...IOSAppFont.footnote, flex: 1 },
  input: { minHeight: 64, borderRadius: 10, paddingHorizontal: 12, paddingTop: 10, fontFamily: "Poppins_400Regular", fontSize: 14, textAlignVertical: "top", marginTop: 6 },
  actions: { flexDirection: "row", gap: 10, marginTop: 10 },
  secondaryBtn: { flex: 1, height: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { ...IOSAppFont.body, fontFamily: "Poppins_600SemiBold" },
  primaryBtn: { flex: 2, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  primaryText: { ...IOSAppFont.body, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  empty: { ...IOSAppFont.subheadline, textAlign: "center", paddingHorizontal: 32, paddingTop: 24 },
});
