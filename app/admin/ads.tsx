// app/admin/ads.tsx
//
// The ad-partner console. Where inventory comes from.
//
// ── Why this exists in the app at all ──────────────────────────────────────
// The rewarded-ads system serves from `ad_creatives`, and that table is filled
// by a person, not by code. The alternatives were a separate web dashboard —
// another deployment, another auth system, another thing to secure, for a table
// that will hold tens of rows — or a SQL console, which nobody will use at 11pm
// when a partner's campaign is meant to start.
//
// ── Access ─────────────────────────────────────────────────────────────────
// The route renders nothing without `is_admin()`. That is a courtesy, not the
// security boundary: every RPC behind it re-checks in the database, so a build
// with this check patched out still gets "admin only" from Postgres.
//
// To grant admin (service role only — it cannot be done from a client):
//     UPDATE public.users SET is_admin = true WHERE username = 'you';

import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Switch,
} from "react-native";
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { ArrowLeft01Icon, PlusSignIcon, Building03Icon } from "@hugeicons/core-free-icons";

import { Glass, useIOSTheme, IOSAppFont, iosAlert, IOSSegmentedTabs } from "@/components/ios";
import {
  amIAdmin,
  listPartners,
  listCreatives,
  savePartner,
  saveCreative,
  setCreativeActive,
  type AdPartner,
  type AdCreativeRow,
} from "@/src/services/adAdmin";
import { BillboardReviews } from "@/components/admin/BillboardReviews";

type Tab = "creatives" | "partners" | "billboards";

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

/** A labelled text field. The console is mostly these. */
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "url";
  multiline?: boolean;
  hint?: string;
}) {
  const t = useIOSTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: t.secondaryLabel }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: t.tertiarySystemFill, color: t.label },
          multiline && { height: 76, textAlignVertical: "top", paddingTop: 10 },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.tertiaryLabel}
        keyboardType={keyboardType === "url" ? "url" : keyboardType}
        autoCapitalize={keyboardType === "url" ? "none" : "sentences"}
        multiline={multiline}
      />
      {hint ? <Text style={[styles.fieldHint, { color: t.tertiaryLabel }]}>{hint}</Text> : null}
    </View>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  const t = useIOSTheme();
  return (
    <View style={styles.statChip}>
      <Text style={[styles.statChipValue, { color: t.label }]}>{value}</Text>
      <Text style={[styles.statChipLabel, { color: t.tertiaryLabel }]}>{label}</Text>
    </View>
  );
}

export default function AdConsoleScreen() {
  const t = useIOSTheme();
  const insets = useSafeAreaInsets();

  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  const [tab, setTab] = React.useState<Tab>("creatives");
  const [partners, setPartners] = React.useState<AdPartner[]>([]);
  const [creatives, setCreatives] = React.useState<AdCreativeRow[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Composer state. One form for both kinds; which fields show depends on `tab`.
  const [editing, setEditing] = React.useState<null | "creative" | "partner">(null);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [formId, setFormId] = React.useState<string | null>(null);
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = React.useCallback(async () => {
    try {
      const [p, c] = await Promise.all([listPartners(), listCreatives(true)]);
      setPartners(p);
      setCreatives(c);
    } catch (e: any) {
      iosAlert("Couldn't load", e?.message ?? "Please try again.");
    }
  }, []);

  React.useEffect(() => {
    amIAdmin().then((ok) => {
      setAllowed(ok);
      if (ok) load();
    });
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openNew = (kind: "creative" | "partner") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFormId(null);
    setForm(
      kind === "creative"
        ? { format: "rewarded", duration: "15", weight: "1", ctaLabel: "Learn more", category: "general" }
        : { budget: "0", cpm: "0" },
    );
    setEditing(kind);
  };

  const openEdit = (c: AdCreativeRow) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFormId(c.id);
    setForm({
      partnerId: c.partner_id ?? "",
      advertiser: c.advertiser_name,
      headline: c.headline,
      body: c.body,
      mediaUrl: c.media_url ?? "",
      mediaType: c.media_type ?? "video",
      ctaLabel: c.cta_label,
      ctaUrl: c.cta_url,
      format: c.format,
      duration: String(c.duration_seconds),
      skipAfter: c.skip_after_seconds == null ? "" : String(c.skip_after_seconds),
      category: c.category,
      weight: String(c.weight),
      appName: c.app_name ?? "",
      appIcon: c.app_icon ?? "",
      appStoreUrl: c.app_store_url ?? "",
      playStoreUrl: c.play_store_url ?? "",
    });
    setEditing("creative");
  };

  const submit = async () => {
    setSaving(true);
    try {
      if (editing === "partner") {
        await savePartner({
          id: formId,
          name: form.name ?? "",
          handle: form.handle || null,
          logoUrl: form.logo || null,
          email: form.email || null,
          phone: form.phone || null,
          budget: Number(form.budget || 0),
          cpm: Number(form.cpm || 0),
        });
      } else {
        await saveCreative({
          id: formId,
          partnerId: form.partnerId || null,
          advertiserName: form.advertiser || null,
          headline: form.headline ?? "",
          body: form.body ?? "",
          mediaUrl: form.mediaUrl || null,
          mediaType: (form.mediaType as any) || null,
          ctaLabel: form.ctaLabel || "Learn more",
          ctaUrl: form.ctaUrl ?? "",
          format: (form.format as any) || "rewarded",
          durationSeconds: Number(form.duration || 15),
          skipAfterSeconds: form.skipAfter ? Number(form.skipAfter) : null,
          category: form.category || "general",
          weight: Number(form.weight || 1),
          appName: form.appName || null,
          appIcon: form.appIcon || null,
          appStoreUrl: form.appStoreUrl || null,
          playStoreUrl: form.playStoreUrl || null,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(null);
      await load();
    } catch (e: any) {
      // The database owns validation, so its message is the useful one — it says
      // exactly which field is missing.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      iosAlert("Couldn't save", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (c: AdCreativeRow) => {
    Haptics.selectionAsync();
    try {
      await setCreativeActive(c.id, !c.active);
      await load();
    } catch (e: any) {
      iosAlert("Couldn't update", e?.message ?? "Please try again.");
    }
  };

  const topInset = insets.top + 54;

  if (allowed === null) {
    return (
      <View style={[styles.centre, { backgroundColor: t.systemBackground }]}>
        <ActivityIndicator color={t.tint} />
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={[styles.centre, { backgroundColor: t.systemBackground, padding: 32 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={[styles.emptyTitle, { color: t.label }]}>Not available</Text>
        <Text style={[styles.emptyBody, { color: t.secondaryLabel }]}>
          The ad console is for administrators. If that should be you, ask for the flag to be set on
          your account.
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 18 }}>
          <Text style={[styles.link, { color: t.tint }]}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.systemGroupedBackground }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        contentContainerStyle={{ paddingTop: topInset + 16, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            progressViewOffset={topInset}
            tintColor={t.tint}
          />
        }
      >
        <View style={styles.tabWrap}>
          <IOSSegmentedTabs<Tab>
            segments={[
              { key: "creatives", label: `Ads (${creatives.length})` },
              { key: "partners", label: `Partners (${partners.length})` },
              { key: "billboards", label: "Billboards" },
            ]}
            active={tab}
            onChange={(k) => {
              Haptics.selectionAsync();
              setTab(k);
            }}
            variant="capsule"
          />
        </View>

        {/* ── The billboards' review queue (EMILGO Games) ─────────────────── */}
        {tab === "billboards" ? <BillboardReviews /> : null}

        {/* ── The composer ────────────────────────────────────────────────── */}
        {tab === "billboards" ? null : editing ? (
          <View style={[styles.card, { backgroundColor: t.secondarySystemGroupedBackground }]}>
            <Text style={[styles.cardTitle, { color: t.label }]}>
              {formId ? "Edit" : "New"} {editing}
            </Text>

            {editing === "partner" ? (
              <>
                <Field label="Partner name" value={form.name ?? ""} onChangeText={set("name")} placeholder="e.g. OPay" />
                <Field label="Handle" value={form.handle ?? ""} onChangeText={set("handle")} placeholder="@opay" />
                <Field label="Logo URL" value={form.logo ?? ""} onChangeText={set("logo")} keyboardType="url" />
                <Field label="Contact email" value={form.email ?? ""} onChangeText={set("email")} keyboardType="url" />
                <Field
                  label="Budget (₦)"
                  value={form.budget ?? ""}
                  onChangeText={set("budget")}
                  keyboardType="numeric"
                  hint="Serving stops when spend reaches this. 0 means uncapped."
                />
                <Field
                  label="CPM (₦ per 1,000 impressions)"
                  value={form.cpm ?? ""}
                  onChangeText={set("cpm")}
                  keyboardType="numeric"
                  hint="What the partner pays you. What the USER earns is set separately in ad_reward_config — the gap is your margin."
                />
              </>
            ) : (
              <>
                <Field
                  label="Partner ID"
                  value={form.partnerId ?? ""}
                  onChangeText={set("partnerId")}
                  placeholder="Paste from the Partners tab"
                  hint="Leave blank for a house ad — it will serve with no budget cap and bill nobody."
                />
                <Field label="Advertiser name" value={form.advertiser ?? ""} onChangeText={set("advertiser")} />
                <Field label="Headline" value={form.headline ?? ""} onChangeText={set("headline")} placeholder="Required" />
                <Field label="Body" value={form.body ?? ""} onChangeText={set("body")} multiline />
                <Field
                  label="Media URL"
                  value={form.mediaUrl ?? ""}
                  onChangeText={set("mediaUrl")}
                  keyboardType="url"
                  hint="Required for rewarded and interstitial. An MP4 for video, a JPG/PNG for image."
                />
                <Field label="Media type (image | video)" value={form.mediaType ?? ""} onChangeText={set("mediaType")} />
                <Field label="Button label" value={form.ctaLabel ?? ""} onChangeText={set("ctaLabel")} />
                <Field
                  label="Destination URL"
                  value={form.ctaUrl ?? ""}
                  onChangeText={set("ctaUrl")}
                  keyboardType="url"
                  placeholder="Required"
                />
                <Field
                  label="Format (rewarded | interstitial | banner | feed)"
                  value={form.format ?? ""}
                  onChangeText={set("format")}
                />
                <Field label="Duration (seconds)" value={form.duration ?? ""} onChangeText={set("duration")} keyboardType="numeric" />
                <Field
                  label="Skippable after (seconds)"
                  value={form.skipAfter ?? ""}
                  onChangeText={set("skipAfter")}
                  keyboardType="numeric"
                  hint="Blank means not skippable. Skipping forfeits the viewer's reward."
                />
                <Field
                  label="Category"
                  value={form.category ?? ""}
                  onChangeText={set("category")}
                  hint="Users can mute a whole category, so keep these meaningful: finance, food, telco…"
                />
                <Field
                  label="Weight"
                  value={form.weight ?? ""}
                  onChangeText={set("weight")}
                  keyboardType="numeric"
                  hint="Higher wins more of the auction. Ties break randomly."
                />

                <Text style={[styles.groupTitle, { color: t.tertiaryLabel }]}>
                  APP INSTALL (optional — drives the post-roll card)
                </Text>
                <Field label="App name" value={form.appName ?? ""} onChangeText={set("appName")} />
                <Field label="App icon URL" value={form.appIcon ?? ""} onChangeText={set("appIcon")} keyboardType="url" />
                <Field label="App Store URL" value={form.appStoreUrl ?? ""} onChangeText={set("appStoreUrl")} keyboardType="url" />
                <Field label="Play Store URL" value={form.playStoreUrl ?? ""} onChangeText={set("playStoreUrl")} keyboardType="url" />
              </>
            )}

            <View style={styles.formActions}>
              <Pressable onPress={() => setEditing(null)} style={styles.secondaryBtn}>
                <Text style={[styles.secondaryBtnText, { color: t.secondaryLabel }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={saving}
                style={[styles.primaryBtn, { backgroundColor: t.tint, opacity: saving ? 0.6 : 1 }]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => openNew(tab === "partners" ? "partner" : "creative")}
            style={[styles.addRow, { backgroundColor: t.secondarySystemGroupedBackground }]}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={18} color={t.tint} strokeWidth={2} />
            <Text style={[styles.addRowText, { color: t.tint }]}>
              New {tab === "partners" ? "partner" : "ad"}
            </Text>
          </Pressable>
        )}

        {/* ── The list ────────────────────────────────────────────────────── */}
        {tab === "billboards"
          ? null
          : tab === "partners"
          ? partners.map((p) => (
              <View
                key={p.id}
                style={[styles.card, { backgroundColor: t.secondarySystemGroupedBackground }]}
              >
                <View style={styles.rowHead}>
                  <HugeiconsIcon icon={Building03Icon} size={18} color={t.tint} strokeWidth={2} />
                  <Text style={[styles.rowTitle, { color: t.label }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                </View>
                <Text selectable style={[styles.mono, { color: t.tertiaryLabel }]}>
                  {p.id}
                </Text>
                <View style={styles.statRow}>
                  <StatChip label="Ads" value={String(p.creatives)} />
                  <StatChip label="Impressions" value={String(p.impressions)} />
                  <StatChip label="Spend" value={naira(p.spend_naira)} />
                  <StatChip
                    label="Budget"
                    value={p.budget_naira > 0 ? naira(p.budget_naira) : "Uncapped"}
                  />
                </View>
                {p.budget_naira > 0 && p.spend_naira >= p.budget_naira ? (
                  <Text style={[styles.warn, { color: t.systemOrange }]}>
                    Budget exhausted — these ads have stopped serving.
                  </Text>
                ) : null}
              </View>
            ))
          : creatives.map((c) => (
              <View
                key={c.id}
                style={[styles.card, { backgroundColor: t.secondarySystemGroupedBackground }]}
              >
                <View style={styles.rowHead}>
                  <Text style={[styles.rowTitle, { color: t.label }]} numberOfLines={1}>
                    {c.headline}
                  </Text>
                  <Switch value={c.active} onValueChange={() => togglePause(c)} />
                </View>
                <Text style={[styles.rowSub, { color: t.tertiaryLabel }]} numberOfLines={1}>
                  {[c.partner_name ?? c.advertiser_name, c.format, c.category, `${c.duration_seconds}s`]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                <View style={styles.statRow}>
                  <StatChip label="Impressions" value={String(c.impressions)} />
                  <StatChip label="Completions" value={String(c.completions)} />
                  <StatChip label="Clicks" value={String(c.clicks)} />
                  <StatChip label="Spend" value={naira(c.spend_naira)} />
                </View>
                <Pressable onPress={() => openEdit(c)} style={{ marginTop: 8 }}>
                  <Text style={[styles.link, { color: t.tint }]}>Edit</Text>
                </Pressable>
              </View>
            ))}

        {!creatives.length && tab === "creatives" && !editing ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: t.label }]}>No ads yet</Text>
            <Text style={[styles.emptyBody, { color: t.secondaryLabel }]}>
              Until there is at least one active rewarded ad, “Watch &amp; earn” has nothing to show
              and will say so. Add a partner first, then an ad against it.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { paddingTop: insets.top, height: topInset }]}>
        <Glass
          variant="regular"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={60}
          fallbackTint={t.systemBackground}
        />
        <View style={styles.barRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={24} color={t.label} strokeWidth={2} />
          </Pressable>
          <Text style={[styles.barTitle, { color: t.label }]}>Ad console</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },

  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20, overflow: "hidden" },
  barRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  barTitle: { ...IOSAppFont.headline },

  tabWrap: { paddingHorizontal: 16, paddingBottom: 12 },

  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 14,
    borderRadius: 14,
  },
  addRowText: { ...IOSAppFont.body, fontFamily: "Poppins_600SemiBold" },

  card: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14, gap: 6 },
  cardTitle: { ...IOSAppFont.headline, textTransform: "capitalize", marginBottom: 4 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { ...IOSAppFont.body, fontFamily: "Poppins_600SemiBold", flex: 1 },
  rowSub: { ...IOSAppFont.caption1 },
  mono: { ...IOSAppFont.caption2, fontFamily: "Poppins_400Regular" },
  warn: { ...IOSAppFont.caption1, marginTop: 4 },
  link: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },

  statRow: { flexDirection: "row", gap: 14, marginTop: 8, flexWrap: "wrap" },
  statChip: { gap: 1 },
  statChipValue: { ...IOSAppFont.subheadline, fontFamily: "Poppins_700Bold" },
  statChipLabel: { ...IOSAppFont.caption2, textTransform: "uppercase", letterSpacing: 0.4 },

  field: { gap: 5, marginTop: 8 },
  fieldLabel: { ...IOSAppFont.caption1, fontFamily: "Poppins_500Medium" },
  fieldHint: { ...IOSAppFont.caption2, lineHeight: 15 },
  input: {
    height: 42,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontFamily: "Poppins_400Regular",
    fontSize: 14,
  },
  groupTitle: {
    ...IOSAppFont.caption2,
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 2,
  },

  formActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  secondaryBtn: { flex: 1, height: 44, alignItems: "center", justifyContent: "center" },
  secondaryBtnText: { ...IOSAppFont.body },
  primaryBtn: { flex: 2, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { ...IOSAppFont.body, fontFamily: "Poppins_600SemiBold", color: "#fff" },

  empty: { paddingHorizontal: 32, paddingTop: 40, alignItems: "center", gap: 8 },
  emptyTitle: { ...IOSAppFont.headline },
  emptyBody: { ...IOSAppFont.subheadline, textAlign: "center", lineHeight: 20 },
});
