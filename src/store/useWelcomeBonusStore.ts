import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/src/services/supabase";

export type WelcomeBonusStatus = "none" | "pending" | "watching" | "claimed";

interface WelcomeBonusStore {
  isEligible: boolean;
  status: WelcomeBonusStatus;
  adsWatched: number;
  bonusAmount: number;
  targetAds: number;

  checkEligibility: (userId: string) => Promise<void>;
  startClaiming: (userId: string) => Promise<void>;
  incrementAdWatched: (userId: string) => Promise<void>;
  claimBonus: (userId: string) => Promise<void>;
}

export const useWelcomeBonusStore = create<WelcomeBonusStore>()(
  persist(
    (set, get) => ({
      isEligible: false,
      status: "none",
      adsWatched: 0,
      bonusAmount: 1200,
      targetAds: 5,

      checkEligibility: async (userId: string) => {
        try {
          // Check server for eligibility and current status
          const { data: eligibleData, error: eligibleError } = await supabase.rpc(
            "check_welcome_bonus_eligibility",
            { p_user_id: userId }
          );

          if (!eligibleError && eligibleData) {
            set({ isEligible: true });
          } else {
            set({ isEligible: false });
            return;
          }

          const { data: claimData, error: claimError } = await supabase
            .from("welcome_bonus_claims")
            .select("*")
            .eq("user_id", userId)
            .single();

          if (claimData) {
            set({
              status: claimData.status as WelcomeBonusStatus,
              adsWatched: claimData.ads_watched,
            });
          } else {
            set({ status: "none", adsWatched: 0 });
          }
        } catch (e) {
          console.warn("[WelcomeBonus] Failed to check eligibility", e);
        }
      },

      startClaiming: async (userId: string) => {
        try {
          const { error } = await supabase
            .from("welcome_bonus_claims")
            .upsert({ user_id: userId, status: "watching", ads_watched: 0 });
          if (!error) {
            set({ status: "watching", adsWatched: 0 });
          }
        } catch (e) {
          console.warn("[WelcomeBonus] Failed to start claiming", e);
        }
      },

      incrementAdWatched: async (userId: string) => {
        const { adsWatched, targetAds, status } = get();
        if (status !== "watching") return;

        const nextCount = adsWatched + 1;
        set({ adsWatched: nextCount });

        try {
          await supabase
            .from("welcome_bonus_claims")
            .update({ ads_watched: nextCount })
            .eq("user_id", userId);

          if (nextCount >= targetAds) {
            await get().claimBonus(userId);
          }
        } catch (e) {
          console.warn("[WelcomeBonus] Failed to update ad count", e);
        }
      },

      claimBonus: async (userId: string) => {
        try {
          // Mark as claimed
          await supabase
            .from("welcome_bonus_claims")
            .update({ status: "claimed" })
            .eq("user_id", userId);
          set({ status: "claimed" });

          // The actual pool credit will be handled by triggering addPoolEntry from outside
        } catch (e) {
          console.warn("[WelcomeBonus] Failed to claim bonus", e);
        }
      },
    }),
    {
      name: "teqil-welcome-bonus",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isEligible: state.isEligible,
        status: state.status,
        adsWatched: state.adsWatched,
      }),
    }
  )
);
