// src/services/billboards.ts
//
// Billboards in EMILGO Games (games/emilgo-games/SPEC-V3.md §8), the app's side:
// the advertiser portal (app/advertise) and the review queue in the Ad console.
//
// Everything that decides anything is in the database
// (supabase/migrations/migration_game_billboards.sql): a submission waits for a
// person whatever this file sends; media must be in the advertiser's own folder;
// a payment is settled only by the app's server after the provider confirms it
// (server/adBilling.ts). Billboards never show in Lagos Life, and nothing here
// knows or stores who saw a board.

import { Platform } from "react-native";

import { getApiBaseUrl } from "./api";
import { supabase } from "./supabase";

export const AD_MEDIA_BUCKET = "ad-media";
/** Pictures up to 2 MB, films up to 20 MB (the bucket refuses more). */
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_VIDEO = 20 * 1024 * 1024;

export type BoardFormat = "static" | "slideshow" | "video";
export type PayProvider = "paystack" | "flutterwave" | "stripe";

/** The content rules every billboard is checked against (the advertiser confirms; a reviewer checks). */
export const BILLBOARD_RULES: { id: string; label: string }[] = [
  { id: "no_gambling", label: "No gambling: no casinos, lotteries, jackpots or games of chance" },
  { id: "no_betting", label: "No betting: no sports betting, odds or wagers" },
  { id: "no_adult", label: "Nothing adult or sexual" },
  { id: "no_crypto", label: "No crypto, forex, tokens or trading schemes" },
  { id: "no_scam", label: "No scams: no promised returns, loan apps or giveaways for money" },
  { id: "vatar_4h", label: "Nothing else the Lagos Life developer agreement §4(h) prohibits" },
];

export const MAP_NAMES: Record<string, string> = {
  "naija-world": "Naija World (Free For All)",
  "spooky-world": "Spooky World (Dead Streets)",
};

export interface BoardSlot {
  id: string;
  map: string;
  kind: string;
  premium: boolean;
  label: string;
}

export interface AdPrices {
  rotation_cpm: number;
  premium_cpm: number;
  min_budget: number;
  /** The prices are test-mode placeholders until the owner sets them. */
  placeholder: boolean;
}

export interface AdAccount {
  id: string;
  name: string;
  budget: number;
  spent: number;
  cpm: number;
  active: boolean;
}

export interface MyBillboard {
  id: string;
  headline: string;
  board_format: BoardFormat;
  review_status: "pending" | "approved" | "rejected";
  review_notes: string | null;
  active: boolean;
  maps: string[];
  slot_ids: string[];
  static_premium: boolean;
  cycle_s: number;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  views: number;
  seconds: number;
}

export interface BillboardReview {
  id: string;
  partner_id: string | null;
  partner_name: string | null;
  budget_naira: number;
  paid_naira: number;
  headline: string;
  cta_url: string;
  board_format: BoardFormat;
  media_url: string | null;
  slides: string[];
  poster_url: string | null;
  maps: string[];
  slot_ids: string[];
  static_premium: boolean;
  cycle_s: number;
  audio: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  review_status: "pending" | "approved" | "rejected";
  review_notes: string | null;
  review_rules: string[];
  content_flags: string[];
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** The caller's advertiser account and the prices (made the first time a name is given). */
export async function myAccount(name?: string, email?: string): Promise<{ account: AdAccount | null; prices: AdPrices }> {
  const { data, error } = await supabase.rpc("my_ad_account", { p_name: name ?? null, p_email: email ?? null });
  fail(error);
  const d = data as { account: AdAccount | null; prices: AdPrices };
  return {
    account: d.account ? { ...d.account, budget: Number(d.account.budget), spent: Number(d.account.spent), cpm: Number(d.account.cpm) } : null,
    prices: {
      rotation_cpm: Number(d.prices.rotation_cpm),
      premium_cpm: Number(d.prices.premium_cpm),
      min_budget: Number(d.prices.min_budget),
      placeholder: !!d.prices.placeholder,
    },
  };
}

export async function listSlots(): Promise<BoardSlot[]> {
  const { data, error } = await supabase.from("game_billboard_slots").select("id, map, kind, premium, label").order("id");
  fail(error);
  return (data ?? []) as BoardSlot[];
}

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" };

/**
 * Upload a picture or a film into the advertiser's own folder and return its
 * public URL (the game loads it from there). The folder is the account's id:
 * the storage policy checks exactly that.
 */
export async function uploadAdMedia(localUri: string, kind: "image" | "video", mimeHint?: string | null): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Sign in to upload.");

  let bytes: Uint8Array;
  if (Platform.OS === "web") {
    bytes = new Uint8Array(await (await fetch(localUri)).arrayBuffer());
  } else {
    const { File } = await import("expo-file-system");
    bytes = await new File(localUri).bytes();
  }
  if (bytes.byteLength > (kind === "video" ? MAX_VIDEO : MAX_IMAGE)) {
    throw new Error(kind === "video" ? "That film is too large. Keep it under 20 MB." : "That picture is too large. Keep it under 2 MB.");
  }
  const fromUri = (localUri.split("?")[0].split(".").pop() || "").toLowerCase();
  const fromMime = mimeHint?.split("/")[1]?.replace("jpeg", "jpg");
  const ext = MIME[fromUri] ? fromUri : fromMime && MIME[fromMime] ? fromMime : kind === "video" ? "mp4" : "jpg";
  const contentType = MIME[ext];
  if (kind === "video" ? contentType !== "video/mp4" : !contentType.startsWith("image/")) {
    throw new Error(kind === "video" ? "Films must be MP4." : "Pictures must be JPEG, PNG or WebP.");
  }
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(AD_MEDIA_BUCKET).upload(path, bytes, { contentType, upsert: false });
  fail(error);
  return supabase.storage.from(AD_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

export interface BillboardInput {
  headline: string;
  website: string;
  format: BoardFormat;
  mediaUrl?: string | null;
  slides?: string[];
  posterUrl?: string | null;
  maps: string[];
  slots: string[];
  premium: boolean;
  cycle: 0 | 10 | 30;
  audio: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  attest: string[];
}

/** Submit a billboard: it waits for review, off the air. */
export async function submitBillboard(b: BillboardInput): Promise<string> {
  const { data, error } = await supabase.rpc("submit_billboard_ad", {
    p_headline: b.headline,
    p_website: b.website,
    p_format: b.format,
    p_media_url: b.mediaUrl ?? null,
    p_slides: b.slides ?? [],
    p_poster_url: b.posterUrl ?? null,
    p_maps: b.maps,
    p_slots: b.slots,
    p_premium: b.premium,
    p_cycle: b.cycle,
    p_audio: b.audio,
    p_starts_at: b.startsAt ?? new Date().toISOString(),
    p_ends_at: b.endsAt ?? null,
    p_attest: b.attest,
  });
  fail(error);
  return data as string;
}

export async function myBillboards(): Promise<MyBillboard[]> {
  const { data, error } = await supabase.rpc("my_billboard_ads");
  fail(error);
  return ((data ?? []) as MyBillboard[]).map((r) => ({ ...r, views: Number(r.views), seconds: Number(r.seconds) }));
}

async function serverCall<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("Payments need the EMILGO server (EXPO_PUBLIC_API_URL is not set).");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in first.");
  const resp = await fetch(`${base}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) throw new Error(json.error || `Server error ${resp.status}`);
  return json;
}

export interface Checkout {
  reference: string;
  /** Where to pay (the provider's page), or null in test mode with no keys (settled at once when the server allows it). */
  checkout_url: string | null;
  mock?: boolean;
  settled?: boolean;
}

/** Start paying for a budget: the server opens the payment and the provider's checkout. */
export function startCheckout(provider: PayProvider, amountNaira: number, creativeId?: string | null): Promise<Checkout> {
  const returnUrl = Platform.OS === "web" && typeof window !== "undefined" ? `${window.location.origin}/advertise` : null;
  return serverCall<Checkout>("/api/ads/checkout", { method: "POST", body: { provider, amount_naira: amountNaira, creative_id: creativeId ?? null, return_url: returnUrl } });
}

/** Ask the server to check a payment with its provider (and settle it if it went through). */
export function verifyPayment(reference: string, sessionId?: string | null): Promise<{ ok: boolean; reason: string }> {
  const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  return serverCall(`/api/ads/verify/${encodeURIComponent(reference)}${q}`, { method: "GET" });
}

// ── The review queue (admins; the database refuses everyone else) ──────────

export async function listReviews(status: "pending" | "approved" | "rejected" | null = "pending"): Promise<BillboardReview[]> {
  const { data, error } = await supabase.rpc("list_billboard_reviews", { p_status: status });
  fail(error);
  return ((data ?? []) as BillboardReview[]).map((r) => ({
    ...r,
    budget_naira: Number(r.budget_naira),
    paid_naira: Number(r.paid_naira),
    slides: Array.isArray(r.slides) ? r.slides : [],
  }));
}

export async function reviewBillboard(id: string, approve: boolean, notes: string, rules: string[]): Promise<void> {
  const { error } = await supabase.rpc("review_billboard_ad", { p_id: id, p_approve: approve, p_notes: notes || null, p_rules: rules });
  fail(error);
}
