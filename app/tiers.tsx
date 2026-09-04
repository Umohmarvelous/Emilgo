/**
 * app/tiers.tsx
 *
 * Emilgo Premium — Free / Pro / Elite. Redesigned to match the provided premium
 * mockups: a row of plan cards with a "Popular" highlight on top, a Free/Pro/Elite
 * benefits comparison table below, and a sticky upgrade CTA.
 *
 * Pricing is DERIVED from the current fuel price via useTierStore (Pro = 4× a
 * litre, Elite = 8×). The CTA runs the (mock) Paystack premium charge (60/40
 * station/company split) and records the purchase to the revenue ledger — which
 * then surfaces as a receipt in the user's history. When the checkout screen is
 * live, the CTA will route there instead of charging inline.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { IOSScreen, useCollapsibleScroll, iosAlert } from "@/components/ios";
import { useAuthStore } from "@/src/store/useStore";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { useTierStore } from "@/src/store/useTierStore";
import { PaystackService, computePremiumSplit } from "@/src/services/paystack";
import { useTransactionsStore } from "@/src/store/useTransactionsStore";
import { formatNaira } from "@/src/utils/helpers";
import type { PremiumTier } from "@/src/models/types";

const txnId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const MOCK_STATION_SUBACCOUNT = "ACCT_mock_station";

const PLAN_ORDER: PremiumTier[] = ["free", "pro", "elite"];
const PLAN_NAME: Record<PremiumTier, string> = { free: "Free", pro: "Pro", elite: "Elite" };

// Unified benefit matrix for the comparison table.
const BENEFITS: { icon: keyof typeof Ionicons.glyphMap; label: string; free: boolean; pro: boolean; elite: boolean }[] = [
  { icon: "navigate-outline", label: "Live trip tracking", free: true, pro: true, elite: true },
  { icon: "cash-outline", label: "Earn fuel coins", free: true, pro: true, elite: true },
  { icon: "flash-outline", label: "Priority driver matching", free: false, pro: true, elite: true },
  { icon: "trending-up-outline", label: "Higher reward multiplier", free: false, pro: true, elite: true },
  { icon: "eye-off-outline", label: "Ad-free feed", free: false, pro: true, elite: true },
  { icon: "gift-outline", label: "Free-ride & fuel boosts", free: false, pro: false, elite: true },
  { icon: "map-outline", label: "Exclusive routes & offers", free: false, pro: false, elite: true },
  { icon: "headset-outline", label: "Priority support", free: false, pro: true, elite: true },
];

export default function TiersScreen() {
  const insets = useSafeAreaInsets();
  const scroll = useCollapsibleScroll();
  const { theme } = useSettingsStore();
  const isDark = theme === "dark";

  const user = useAuthStore((s) => s.user);
  const currentTier = useTierStore((s) => s.tier);
  const setTier = useTierStore((s) => s.setTier);
  const priceForTier = useTierStore((s) => s.priceForTier);

  const [selected, setSelected] = useState<PremiumTier>(currentTier === "free" ? "pro" : currentTier);
  const [processing, setProcessing] = useState(false);

  const textColor = isDark ? Colors.textWhite : Colors.text;
  const cardBg = isDark ? Colors.overlayLight : "#FFFFFF";
  const bg = isDark ? Colors.background : "#F6F7FB";
  const subColor = isDark ? Colors.textSecondary : Colors.textTertiary;
  const borderColor = isDark ? "rgba(255,255,255,0.10)" : "#ECEEF3";

  const selectedPrice = priceForTier(selected);
  const isSelectedCurrent = selected === currentTier;

  // Runs the (mock) charge, switches tier, records the purchase to history.
  const runUpgrade = async (tier: PremiumTier) => {
    const amount = priceForTier(tier);
    setProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await PaystackService.processPremiumPayment({
        email: user?.email ?? "guest@emilgo.app",
        amount,
        station_subaccount: MOCK_STATION_SUBACCOUNT,
      });
      if (res.success) {
        setTier(tier);
        if (user?.id) {
          const split = computePremiumSplit(amount);
          await useTransactionsStore.getState().record({
            id: txnId(),
            user_id: user.id,
            kind: "premium_subscription",
            premium_amount: amount,
            station_share: split.station_share,
            company_share: split.company_share,
            station_subaccount: MOCK_STATION_SUBACCOUNT,
            status: "success",
            dedupe_key: res.reference,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        iosAlert(
          `You're on ${PLAN_NAME[tier]} 🎉`,
          `Payment of ${formatNaira(amount)} succeeded. Your plan is now active — the receipt is in your history.`
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        iosAlert("Payment failed", "We couldn't complete the payment. Please try again.");
      }
    } finally {
      setProcessing(false);
    }
  };

  const onCtaPress = () => {
    if (isSelectedCurrent || processing) return;

    if (selected === "free") {
      iosAlert("Switch to Free?", "You'll lose your premium perks at the end of the cycle.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Switch to Free",
          style: "destructive",
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setTier("free");
          },
        },
      ]);
      return;
    }

    // Route through the tokenized checkout, which performs the charge, records the
    // purchase (→ receipt in history) and activates the plan.
    Haptics.selectionAsync();
    router.push({
      pathname: "/checkout",
      params: {
        item: `Emilgo ${PLAN_NAME[selected]} (monthly)`,
        amount: String(selectedPrice),
        kind: "premium",
        plan: selected,
      },
    } as any);
  };

  const ctaLabel = isSelectedCurrent
    ? "Your current plan"
    : selected === "free"
      ? "Switch to Free"
      : `Start ${PLAN_NAME[selected]} now`;

  return (
    <View style={styles.root}>
    <IOSScreen
      title="Plans"
      back
      scroll={scroll}
      contentContainerStyle={[styles.content, { paddingBottom: 150 }]}
    >
        <View style={styles.hero}>
          <View style={styles.diamond}>
            <Ionicons name="diamond" size={60} color={Colors.gold} />
          </View>
          <Text style={[styles.title, { color: textColor }]}>Get Premium!</Text>
          <Text style={[styles.subtitle, { color: subColor }]}>
            Priority rides, bigger rewards, ad-free.
          </Text>
        </View>

        {/* Plan cards */}
        <View style={styles.plans}>
          {PLAN_ORDER.map((tier) => {
            const price = priceForTier(tier);
            const isSel = selected === tier;
            const popular = tier === "pro";
            return (
              <Pressable
                key={tier}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelected(tier);
                }}
                style={[
                  styles.plan,
                  { backgroundColor: cardBg, borderColor },
                  popular && styles.planPopular,
                  isSel && { borderColor: Colors.primary, borderWidth: 1.5, backgroundColor: Colors.primary + "22" },
                ]}
              >
                {popular && (
                  <View style={styles.ribbon}>
                    <Text style={styles.ribbonText}>Popular</Text>
                  </View>
                )}
                <Text style={[styles.planName, { color: textColor }]}>{PLAN_NAME[tier]}</Text>
                <Text style={[styles.planPrice, { color: textColor }]}>
                  {price === 0 ? "Free" : formatNaira(price)}
                </Text>
                <Text style={[styles.planPer, { color: subColor }]}>
                  {price === 0 ? "forever" : "per month"}
                </Text>
                {tier === currentTier && (
                  <View style={styles.currentTag}>
                    <Text style={styles.currentTagText}>Current</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Benefits comparison */}
        <View style={[styles.table, { backgroundColor: cardBg, borderColor }]}>
          <View style={[styles.tableHeader, { borderBottomColor: borderColor }]}>
            <Text style={[styles.benefitsHead, { color: textColor }]}>Benefits</Text>
            {PLAN_ORDER.map((t) => (
              <Text
                key={t}
                style={[
                  styles.colHead,
                  { color: t === selected ? Colors.primary : subColor },
                ]}
              >
                {PLAN_NAME[t]}
              </Text>
            ))}
          </View>

          {BENEFITS.map((b) => (
            <View key={b.label} style={[styles.tableRow, { borderBottomColor: borderColor }]}>
              <View style={styles.benefitLabel}>
                <Ionicons name={b.icon} size={16} color={Colors.primary} />
                <Text style={[styles.benefitText, { color: textColor }]} numberOfLines={2}>
                  {b.label}
                </Text>
              </View>
              {([b.free, b.pro, b.elite] as boolean[]).map((on, i) => (
                <View key={i} style={styles.cell}>
                  {on ? (
                    // <Ionicons name="checkmark-circle" size={18} color={PLAN_ORDER === selected ? Colors.primary : subColor } />
                    <Ionicons name="checkmark-circle" size={18} color={ Colors.primary } />
                  ) : (
                    <Text style={[styles.dash, { color: subColor }]}>-</Text>
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>

        <Text style={[styles.footnote, { color: subColor }]}>
          Premium is split 60% to the partner fuel station and 40% to Emilgo. Change or
          cancel anytime.
        </Text>
    </IOSScreen>

      {/* Sticky CTA — absolute, so it floats over the scroll rather than in it. */}
      <View style={[styles.ctaBar, { backgroundColor: bg, paddingBottom: insets.bottom + 12, borderTopColor: borderColor }]}>
        <Pressable
          style={[styles.ctaBtn, (isSelectedCurrent || processing) && styles.ctaDisabled]}
          onPress={onCtaPress}
          disabled={isSelectedCurrent || processing}
        >
          {processing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.ctaText}>{ctaLabel}</Text>
              {!isSelectedCurrent && selected !== "free" && (
                <Text style={styles.ctaSub}>
                  {formatNaira(selectedPrice)} / month · cancel anytime
                </Text>
              )}
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 4 },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  content: { paddingHorizontal: 18 },

  hero: { alignItems: "center", gap: 4, marginBottom: 20 },
  diamond: {
    width: 72,
    height: 72,
    borderRadius: 26,
    // backgroundColor: Colors.goldLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  title: { fontFamily: "Poppins_700Bold", fontSize: 24 },
  subtitle: { fontFamily: "Poppins_400Regular", fontSize: 13.5, textAlign: "center" },

  plans: { flexDirection: "row", gap: 10, marginBottom: 18 },
  plan: {
    flex: 1,
    borderRadius: 20,
    borderWidth: .5,
    paddingVertical: 18,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 2,
  },
  planPopular: {
    // backgroundColor: "#FFFBEB",
    // borderColor: Colors.gold
  },
  ribbon: {
    position: "absolute",
    top: -10,
    backgroundColor: Colors.gold,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  ribbonText: { fontFamily: "Poppins_700Bold", fontSize: 9, color: "#fff", letterSpacing: 0.4 },
  planName: { fontFamily: "Poppins_600SemiBold", fontSize: 14, marginTop: 4 },
  planPrice: { fontFamily: "Poppins_700Bold", fontSize: 17 },
  planPer: { fontFamily: "Poppins_400Regular", fontSize: 10.5 },
  currentTag: {
    marginTop: 6,
    backgroundColor: "rgba(0,154,67,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
  },
  currentTagText: { fontFamily: "Poppins_600SemiBold", fontSize: 9, color: Colors.primary },

  table: { borderRadius: 20, borderWidth: .5, paddingHorizontal: 14, paddingVertical: 4 },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  benefitsHead: { flex: 1, fontFamily: "Poppins_700Bold", fontSize: 13 },
  colHead: { width: 46, textAlign: "center", fontFamily: "Poppins_600SemiBold", fontSize: 12 },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1 },
  benefitLabel: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 8 },
  benefitText: { fontFamily: "Poppins_400Regular", fontSize: 12.5, flex: 1 },
  cell: { width: 46, alignItems: "center", justifyContent: "center" },
  dash: { fontFamily: "Poppins_500Medium", fontSize: 14 },

  footnote: {
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 16,
  },

  ctaBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  ctaBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: "Poppins_700Bold", fontSize: 16, color: "#fff" },
  ctaSub: { fontFamily: "Poppins_400Regular", fontSize: 11.5, color: "rgba(255,255,255,0.85)" },
});
