// src/services/broadcasts.ts
//
// Park broadcasts: send, receive, and know whether anyone read it.
//
// ── The bug this exists to fix ─────────────────────────────────────────────
// `(driver)/messages.tsx` rendered `BroadcastsStorage.getAll()` — AsyncStorage
// and nothing else. A broadcast therefore appeared only if a background sync
// had happened to run first. There was no realtime and no push, so a park owner
// telling their drivers "the road is blocked" had no idea whether that had
// reached anyone, and neither did the drivers.
//
// Everything here goes through RPCs whose park-membership check is server-side,
// because "which park is this driver in" is an access-control question and the
// client is not an access control.

import { supabase } from "@/src/services/supabase";

export type BroadcastPriority = "normal" | "urgent";

export interface DriverBroadcast {
  id: string;
  message: string;
  title: string | null;
  priority: BroadcastPriority;
  sender_name: string | null;
  created_at: string;
  expires_at: string | null;
  read: boolean;
}

export interface SentBroadcast {
  id: string;
  message: string;
  title: string | null;
  priority: BroadcastPriority;
  created_at: string;
  expires_at: string | null;
  /** Drivers who have opened it. */
  read_count: number;
  /** Drivers in the park at the time of asking. */
  reach: number;
}

export type SendFailure = "not_a_park_owner" | "empty" | "bad_priority" | "unknown";

export const SEND_FAILURE_TEXT: Record<SendFailure, string> = {
  not_a_park_owner: "Only a park owner can send a broadcast.",
  empty: "Type a message first.",
  bad_priority: "Pick a normal or urgent notice.",
  unknown: "Could not send. Try again.",
};

// ═════════════════════════════════════════════════════════════════════════════
// SENDING
// ═════════════════════════════════════════════════════════════════════════════

export type SendResult =
  | { ok: true; id: string; reach: number }
  | { ok: false; reason: SendFailure; message: string };

export async function send(
  message: string,
  opts: { title?: string; priority?: BroadcastPriority; expiresAt?: string | null } = {},
): Promise<SendResult> {
  const { data, error } = await supabase.rpc("broadcast_send", {
    p_message: message,
    p_title: opts.title ?? null,
    p_priority: opts.priority ?? "normal",
    p_expires_at: opts.expiresAt ?? null,
  });
  if (error) return { ok: false, reason: "unknown", message: error.message };

  const r = data as any;
  if (!r?.ok) {
    const reason = (r?.reason ?? "unknown") as SendFailure;
    return { ok: false, reason, message: SEND_FAILURE_TEXT[reason] };
  }
  return { ok: true, id: r.id, reach: r.reach ?? 0 };
}

export async function remove(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("broadcast_delete", { p_id: id });
  return !error && !!data;
}

export async function listSent(limit = 50): Promise<SentBroadcast[]> {
  const { data, error } = await supabase.rpc("broadcast_list_sent", { p_limit: limit });
  if (error) {
    console.warn("[Broadcasts] listSent:", error.message);
    return [];
  }
  return (data ?? []) as SentBroadcast[];
}

// ═════════════════════════════════════════════════════════════════════════════
// RECEIVING
// ═════════════════════════════════════════════════════════════════════════════

export async function listForDriver(limit = 50): Promise<DriverBroadcast[]> {
  const { data, error } = await supabase.rpc("broadcast_list_for_driver", { p_limit: limit });
  if (error) {
    console.warn("[Broadcasts] listForDriver:", error.message);
    return [];
  }
  return (data ?? []) as DriverBroadcast[];
}

export async function markRead(id: string): Promise<void> {
  const { error } = await supabase.rpc("broadcast_mark_read", { p_id: id });
  if (error) console.warn("[Broadcasts] markRead:", error.message);
}

/**
 * Deliver new broadcasts the moment they are sent.
 *
 * ── Why this refetches instead of using the payload ────────────────────────
 * Realtime hands over the raw row, which says nothing about whether this driver
 * is in that park — the postgres_changes filter cannot express the join. Using
 * the payload directly would show every park's notices to every driver. The
 * event is only a signal to ask the RPC again, and the RPC is where the
 * membership check lives.
 *
 * Returns an unsubscribe.
 */
export function subscribe(onChange: (rows: DriverBroadcast[]) => void): () => void {
  const channel = supabase
    .channel("broadcasts:driver")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "broadcasts" },
      async () => {
        onChange(await listForDriver());
      },
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "broadcasts" },
      async () => {
        onChange(await listForDriver());
      },
    )
    .subscribe();

  return () => {
    try { supabase.removeChannel(channel); } catch { /* already gone */ }
  };
}

/**
 * A local notification for an urgent notice that arrived while the app is open.
 *
 * Deliberately urgent-only. A push for every routine notice trains drivers to
 * swipe them away, which is precisely the wrong reflex for the one that matters.
 */
export async function notifyIfUrgent(b: DriverBroadcast): Promise<void> {
  if (b.priority !== "urgent" || b.read) return;
  try {
    const N = await import("expo-notifications");
    await N.scheduleNotificationAsync({
      content: {
        title: b.title ? `📢 ${b.title}` : "📢 Urgent notice from your park",
        body: b.message,
        data: { type: "broadcast", broadcastId: b.id },
        sound: "default",
      },
      trigger: null,
    });
  } catch (e) {
    console.warn("[Broadcasts] notify:", e);
  }
}
