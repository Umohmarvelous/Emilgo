// src/services/admob.web.ts
//
// Web stub for AdMob — ads are native-only. Every export matches the real
// module so imports resolve, but every function returns the "unavailable" path.

export type AdMobFormat = "rewarded" | "interstitial";

export interface AdMobLoadResult {
  ok: boolean;
  reason?: "unavailable" | "no_fill" | "error";
  message?: string;
}

export interface AdMobShowResult {
  ok: boolean;
  earned: boolean;
  reason?: "unavailable" | "not_loaded" | "dismissed_early" | "error";
  message?: string;
}

export function isAdMobAvailable(): boolean {
  return false;
}

export function bannerUnitId(): string | null {
  return null;
}

export function isUsingTestUnits(): boolean {
  return true;
}

export async function initAdMob(): Promise<boolean> {
  return false;
}

export function loadRewarded(): Promise<AdMobLoadResult> {
  return Promise.resolve({ ok: false, reason: "unavailable" });
}

export function isRewardedReady(): boolean {
  return false;
}

export function showRewarded(): Promise<AdMobShowResult> {
  return Promise.resolve({ ok: false, earned: false, reason: "unavailable" });
}

export function loadInterstitial(): Promise<AdMobLoadResult> {
  return Promise.resolve({ ok: false, reason: "unavailable" });
}

export function isInterstitialReady(): boolean {
  return false;
}

export function showInterstitial(): Promise<AdMobShowResult> {
  return Promise.resolve({ ok: false, earned: false, reason: "unavailable" });
}

export function getBannerComponent(): null {
  return null;
}
