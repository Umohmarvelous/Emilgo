
// components/BalanceCard.tsx
import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ActivityIndicator } from "react-native";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { Colors } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { usePoolStore } from "@/src/store/usePoolStore";
import { useAuthStore } from "@/src/store/useStore";
import { useWelcomeBonusStore } from "@/src/store/useWelcomeBonusStore";

import { formatNaira } from "@/src/utils/helpers";
import { IOSButton, IOSSheet } from "@/components/ios";

interface BalanceCardProps {
  coins: number;
  onQuickTransferPress: () => void;
}

export default function BalanceCard({
  onQuickTransferPress,
}: BalanceCardProps) {
  const { theme } = useSettingsStore();
  const { user } = useAuthStore();
  
  // Real money pool (₦) — realised ad revenue that discounts the passenger's
  // fares. This is spendable money, unlike the hidden engagement "credits".
  // Driver trip earnings render elsewhere.
  const pool = usePoolStore((s) => s.balance);
  const addPoolEntry = usePoolStore((s) => s.addPoolEntry);
  const [balanceHidden, setBalanceHidden] = useState(false);

  const { isEligible, status, adsWatched, targetAds, bonusAmount, checkEligibility, startClaiming, incrementAdWatched, claimBonus } = useWelcomeBonusStore();

  const isDark = theme === "dark";
  const textColor = isDark ? Colors.textWhite : Colors.text;
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";

  // Check eligibility on mount if user is available
  useEffect(() => {
    if (user?.id) {
      checkEligibility(user.id);
    }
  }, [user?.id, checkEligibility]);

  const [claimModalVisible, setClaimModalVisible] = useState(false);
  const [isWatchingAd, setIsWatchingAd] = useState(false);

  const handleClaimPress = async () => {
    if (!user?.id) return;
    if (status === "none" || status === "pending") {
      await startClaiming(user.id);
    }
    setClaimModalVisible(true);
  };

  const handleWatchAd = () => {
    if (!user?.id) return;
    setIsWatchingAd(true);
    // Simulate watching an ad
    setTimeout(async () => {
      setIsWatchingAd(false);
      await incrementAdWatched(user.id);
      
      const newAdsWatched = useWelcomeBonusStore.getState().adsWatched;
      if (newAdsWatched >= targetAds) {
        setClaimModalVisible(false);
        // Credit the pool account
        await addPoolEntry(user.id, bonusAmount, "ad_revenue", { dedupeKey: `welcome_bonus_${user.id}` });
      }
    }, 2000);
  };

  return (
    <>
      <View style={styles.balanceCard}>
        <Pressable style={
          [styles.balanceIcon, {
            backgroundColor: isDark
              ? Colors.overlayLight
              : Colors.textWhite,
            borderWidth: 1, borderColor, 
            padding: 10, borderRadius: 50
        }]
        } onPress={() => setBalanceHidden((v) => !v)} hitSlop={8}>
          <Ionicons
            name={balanceHidden ? "eye-off" : "eye"}
            size={20} 
            color= {textColor}
          />
        </Pressable>
        <View style={styles.balanceRow}>
          <Text style={[styles.balanceValue, {color: textColor}]}>
            {balanceHidden ? "* * * * *" : formatNaira(pool)}
          </Text>
        </View>
        <Text style={styles.balanceEquiv}>Pool balance</Text>

        {isEligible && status !== "claimed" && (
          <Pressable style={[styles.claimButton, { borderColor }]} onPress={handleClaimPress}>
            <Text style={styles.claimButtonText}>
              Claim {formatNaira(bonusAmount)} Welcome Bonus!
            </Text>
            {status === "watching" && (
              <Text style={styles.claimSubText}>
                ({adsWatched}/{targetAds} ads watched)
              </Text>
            )}
          </Pressable>
        )}
      </View>

      <IOSSheet
        visible={claimModalVisible}
        onClose={() => setClaimModalVisible(false)}
        title="Welcome Bonus"
        detents={["medium"]}
      >
        <View style={styles.modalContent}>
          <Text style={[styles.modalTitle, { color: textColor }]}>
            Claim your {formatNaira(bonusAmount)}!
          </Text>
          <Text style={[styles.modalText, { color: isDark ? Colors.textSecondary : Colors.textTertiary }]}>
            Watch {targetAds} ads to unlock your free first-time money. You can use it later for your transactions.
          </Text>
          <View style={styles.progressContainer}>
            <Text style={[styles.progressText, { color: textColor }]}>
              Progress: {adsWatched} / {targetAds}
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${(adsWatched / targetAds) * 100}%` }]} />
            </View>
          </View>
          
          <IOSButton
            title={isWatchingAd ? "Watching..." : "Watch Ad"}
            variant="filled"
            onPress={handleWatchAd}
            disabled={isWatchingAd}
            style={styles.watchAdBtn}
          />
          {isWatchingAd && <ActivityIndicator style={{ marginTop: 16 }} color={Colors.primary} />}
        </View>
      </IOSSheet>
    </>
  );
}

// ─── Main Styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  balanceCard: {
    flexDirection: "column",
    gap: 16,
    alignItems: "center",
    flex: 1,
  },
  balanceRow: { 
  },
  balanceValue: {
    fontFamily: "Poppins_700Bold",
    fontSize: 26,
    letterSpacing: -0.5, 
  },
  balanceIcon: {
    alignSelf: 'flex-end',
  },
  balanceEquiv: {
    fontFamily: "Poppins_700Bold",
    fontSize: 12,    
    color: Colors.gold,
  },
  claimButton: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.primaryLight,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
  },
  claimButtonText: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 13,
    color: Colors.primary,
  },
  claimSubText: {
    fontFamily: "Poppins_500Medium",
    fontSize: 11,
    color: Colors.primary,
    marginTop: 2,
  },
  modalContent: {
    padding: 24,
    alignItems: "center",
  },
  modalTitle: {
    fontFamily: "Poppins_700Bold",
    fontSize: 20,
    marginBottom: 8,
  },
  modalText: {
    fontFamily: "Poppins_400Regular",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  progressContainer: {
    width: "100%",
    marginBottom: 32,
  },
  progressText: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 14,
    marginBottom: 8,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: "#E8ECF0",
    borderRadius: 4,
    width: "100%",
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: Colors.primary,
  },
  watchAdBtn: {
    width: "100%",
  }
});