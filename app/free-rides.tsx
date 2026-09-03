/**
 * app/free-rides.tsx
 *
 * Free-rides hub. Drivers get a prominent "Offer a free ride" CTA; everyone sees
 * the open offers. The two modes are always clearly labelled:
 *   • Reward → "Accept only" (no bargaining) unless you're Elite.
 *   • Barter → "You can bargain" (free-will exchange).
 *
 * Accepting is PREMIUM-ONLY and requires GPS to be ON (the ride is tracked). Both
 * are gated here before a claim is made.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, RefreshControl } from "react-native";
import { router } from "expo-router";
// import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useAuthStore } from "@/src/store/useStore";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { useIsPremium, useIsElite } from "@/src/store/useTierStore";
import { useFreeRidesStore, type FreeRideOffer } from "@/src/store/useFreeRidesStore";
import { ensureGpsOn } from "@/src/services/locationTracking";
import { iosAlert, IOSScreen, useCollapsibleScroll, useIOSTheme  } from "@/components/ios";

export default function FreeRidesScreen() {
  const scroll = useCollapsibleScroll();
  const user = useAuthStore((s) => s.user);
  const isDark = useSettingsStore((s) => s.theme) === "dark";
  const { openOffers, fetchOpenOffers, acceptOffer } = useFreeRidesStore();

  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isDriver = user?.role === "driver";
  // Entitlements, not the raw tier — honours the dev override in development.
  const isPremium = useIsPremium();
  const isElite = useIsElite();

  const theme = useIOSTheme()

  const textColor = isDark ? Colors.textWhite : Colors.text;
  const subColor = isDark ? Colors.textSecondary : Colors.textTertiary;
  const borderColor = isDark ? "rgba(255,255,255,0.10)" : "#ECEEF3";

  const offers = useMemo(() => openOffers.filter((o) => o.driver_id !== user?.id), [openOffers, user?.id]);

  const load = async () => {
    setRefreshing(true);
    await fetchOpenOffers();
    setRefreshing(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requirePremium = (): boolean => {
    if (isPremium) return true;
    iosAlert("Premium only", "Free rides are available to Pro and Elite members.", [
      { text: "Not now", style: "cancel" },
      { text: "See plans", onPress: () => router.push("/tiers" as any) },
    ]);
    return false;
  };

  const accept = async (offer: FreeRideOffer) => {
    if (!user?.id || !requirePremium()) return;
    setBusyId(offer.id);
    const gps = await ensureGpsOn();
    if (!gps.ok) {
      setBusyId(null);
      iosAlert(
        "Turn on location",
        gps.granted
          ? "GPS is switched off on this device. Turn on location services, then try again."
          : "GPS must be ON to take a tracked free ride. Enable location for Emilgo in Settings, then try again."
      );
      return;
    }
    const claimId = await acceptOffer(offer.id, user.id);
    setBusyId(null);
    if (claimId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      iosAlert(
        "Ride accepted 🎉",
        offer.mode === "reward"
          ? "Your free ride is booked and will be GPS-tracked from pickup to drop-off. Meet your driver."
          : "You've accepted. Confirm the exchange with your driver — the ride is tracked.",
        [
          { text: "Later", style: "cancel", onPress: load },
          {
            text: "Start tracking",
            onPress: () => {
              load();
              router.push({
                pathname: "/free-ride-track/[claimId]",
                params: {
                  claimId,
                  mode: offer.mode,
                  origin: offer.origin ?? "",
                  destination: offer.destination ?? "",
                  role: "passenger",
                },
              } as any);
            },
          },
        ]
      );
    } else {
      iosAlert("Couldn't accept", "This offer may be full or already taken. Try another.");
    }
  };

  const bargain = (offer: FreeRideOffer) => {
    // Reward offers are accept-only unless you're Elite. Barter is bargainable by all.
    if (offer.mode === "reward" && !isElite) {
      iosAlert(
        "Bargaining is Elite-only here",
        "This is a fixed 'reward' offer — you can only accept it. Upgrade to Elite to bargain on reward offers.",
        [
          { text: "OK", style: "cancel" },
          { text: "See Elite", onPress: () => router.push("/tiers" as any) },
        ]
      );
      return;
    }
    if (!requirePremium()) return;
    // Structured bargaining: proposals, counter-offers and a recorded agreement,
    // rather than a chat thread nobody can be held to.
    Haptics.selectionAsync();
    router.push({
      pathname: "/barter/[offerId]",
      params: { offerId: offer.id, driverId: offer.driver_id },
    } as any);
  };

  return (
    <IOSScreen
      title="Free Rides"
      back
      scroll={scroll}
      contentContainerStyle={{ paddingVertical: 18 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={load}
          progressViewOffset={scroll.contentInset}
          tintColor={Colors.primary}
        />
      }
    >
        {isDriver && (
          <Pressable style={[styles.offerCta, { backgroundColor: theme.systemGreen}]} onPress={() => router.push("/(driver)/free-ride" as any)}>
            <View style={styles.offerCtaIcon}>
            <Ionicons name="add" size={22} color={theme.systemBackground}  />
            </View>
            <View style={{ flex: 1 }}>
            <Text style={[styles.offerCtaTitle, {color: theme.systemBackground}]}>Offer a free ride</Text>
            <Text style={[styles.offerCtaSub, { color: theme.systemGray3}]}>Earn free fuel — or barter for what you need</Text>
            </View>
          <Ionicons name="chevron-forward" size={20} color={ theme.systemBackground } />
          </Pressable>
        )}

        {!isPremium && (
          <Pressable
            style={[styles.premiumBanner, { backgroundColor: Colors.gold + "1F", borderColor }]}
            onPress={() => router.push("/tiers" as any)}
          >
            <Ionicons name="diamond" size={18} color={Colors.gold} />
            <Text style={[styles.premiumText, { color: textColor }]}>
              Free rides are a Premium perk — tap to upgrade.
            </Text>
          </Pressable>
        )}

        <Text style={[styles.sectionTitle, { color: textColor }]}>
          {offers.length} open {offers.length === 1 ? "offer" : "offers"}
        </Text>

        {offers.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="car-outline" size={48} color={subColor} />
            <Text style={[styles.emptyText, { color: subColor }]}>No free rides right now. Pull to refresh.</Text>
          </View>
        ) : (
          offers.map((o) => {
            const isReward = o.mode === "reward";
            const spotsLeft = Math.max(0, o.max_passengers - o.claimed_count);
            const busy = busyId === o.id;
            return (
              <View key={o.id} style={[styles.offerCard, { backgroundColor: 'transparent',  },{borderBottomWidth: .5, borderBottomColor: borderColor }]}>
                <View style={styles.offerTop}>
                  <View style={[styles.modeTag, { backgroundColor: (isReward ? Colors.primary : Colors.gold) + "1F" }]}>
                    <Ionicons name={isReward ? "gift" : "swap-horizontal"} size={13} color={isReward ? Colors.primary : Colors.gold} />
                    <Text style={[styles.modeTagText, { color: isReward ? Colors.primary : Colors.gold }]}>
                      {isReward ? "Reward · accept only" : "Barter · bargainable"}
                    </Text>
                  </View>
                  <Text style={[styles.spots, { color: subColor }]}>{spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left</Text>
                </View>

                <Text style={[styles.offerMeta, { color: textColor }]}>Open for {o.duration_minutes} min</Text>
                {o.barter_terms ? (
                  <Text style={[styles.offerDesc, { color: subColor }]}>Wants: {o.barter_terms}</Text>
                ) : null}
                {o.requirements ? (
                  <Text style={[styles.offerDesc, { color: subColor }]}>Requirements: {o.requirements}</Text>
                ) : null}

                <View style={styles.offerActions}>
                  <Pressable
                    style={[styles.bargainBtn, { borderColor }]}
                    onPress={() => bargain(o)}
                  >
                    <Text style={[styles.bargainText, { color: isReward && !isElite ? subColor : Colors.primary }]}>
                      {isReward ? (isElite ? "Bargain price" : "Bargain price") : "Bargain price"}
                    </Text>
                  </Pressable>
                  <Pressable style={[styles.acceptBtn, busy && { opacity: 0.6 }, { backgroundColor:  Colors.overlayLight}]} onPress={() => accept(o)} disabled={busy}>
                    <Text style={[styles.acceptText, {color: textColor}]}>{busy ? "…" : "Accept"}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
    </IOSScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 8 },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Poppins_700Bold", fontSize: 18 },

  offerCta: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, padding: 16, marginBottom: 16 },
  offerCtaIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  offerCtaTitle: { fontFamily: "Poppins_700Bold", fontSize: 15,  },
  offerCtaSub: { fontFamily: "Poppins_400Regular", fontSize: 11.5, color: "rgba(255,255,255,0.85)", marginTop: 1 },

  premiumBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 13, marginBottom: 16 },
  premiumText: { flex: 1, fontFamily: "Poppins_500Medium", fontSize: 12.5 },

  sectionTitle: { fontFamily: "Poppins_700Bold", fontSize: 14, marginBottom: 12 },
  empty: { alignItems: "center", gap: 12, paddingVertical: 50 },
  emptyText: { fontFamily: "Poppins_400Regular", fontSize: 13, textAlign: "center" },

  offerCard: { paddingVertical: 16, marginBottom: 22, gap: 6, },
  offerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2, },
  modeTag: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  modeTagText: { fontFamily: "Poppins_600SemiBold", fontSize: 11 },
  spots: { fontFamily: "Poppins_500Medium", fontSize: 11.5 },
  offerMeta: { fontFamily: "Poppins_600SemiBold", fontSize: 13.5 },
  offerDesc: { fontFamily: "Poppins_400Regular", fontSize: 12.5, lineHeight: 18 },
  offerActions: { flexDirection: "row", gap: 20, marginTop: 10 },
  bargainBtn: { flex: 1, borderRadius: 52, borderWidth: 1, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  bargainText: { fontFamily: "Poppins_600SemiBold", fontSize: 13 },
  acceptBtn: { flex: 1.2, borderRadius: 52, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  acceptText: { fontFamily: "Poppins_700Bold", fontSize: 13 },
});
