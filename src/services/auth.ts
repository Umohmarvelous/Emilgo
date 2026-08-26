// /**
//  * src/services/auth.ts
//  *
//  * Offline-aware authentication layer on top of Supabase.
//  * - signInOfflineAware: tries Supabase first; if network fails, falls back to
//  *   locally-cached credentials so drivers can log in without internet.
//  * - cacheCredentials / clearCachedCredentials: manage the local cache.
//  */
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import { signUp as supabaseSignUp, signIn as supabaseSignIn } from "./supabase";
// import type { User } from "../models/types";
// // import * as LocalAuthentication from "expo-local-authentication";

// const BIOMETRIC_EMAIL_KEY = "teqil_biometric_email";
// const BIOMETRIC_PW_KEY    = "teqil_biometric_pw"; // use expo-secure-store in production


// const CACHED_USER_KEY = "teqil_cached_user";
// const CACHED_EMAIL_KEY = "teqil_cached_email";
// // We store a bcrypt-style hash in production; for this MVP we store a salted
// // hash so the plain password is never persisted.
// const CACHED_PW_HASH_KEY = "teqil_cached_pw_hash";

// // ─── Simple deterministic hash (NOT crypto-secure; sufficient for offline MVP) ─
// async function hashPassword(password: string, email: string): Promise<string> {
//   // Combine email+password so identical passwords hash differently per user
//   const raw = `${email.toLowerCase().trim()}:${password}`;
//   // Encode to bytes and produce a hex string via subtle crypto when available,
//   // falling back to a lightweight pure-JS version on older RN environments.
//   try {
//     const encoder = new TextEncoder();
//     const data = encoder.encode(raw);
//     const hashBuffer = await crypto.subtle.digest("SHA-256", data);
//     const hashArray = Array.from(new Uint8Array(hashBuffer));
//     return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
//   } catch {
//     // Fallback: djb2 hash (good enough for offline cache guard)
//     let h = 5381;
//     for (let i = 0; i < raw.length; i++) {
//       h = (h * 33) ^ raw.charCodeAt(i);
//     }
//     return (h >>> 0).toString(16);
//   }
// }

// // ─── Cache helpers ────────────────────────────────────────────────────────────

// /** Persist successful login so we can replay it offline. */
// export async function cacheCredentials(
//   user: User,
//   email: string,
//   password: string
// ): Promise<void> {
//   const hash = await hashPassword(password, email);
//   await AsyncStorage.multiSet([
//     [CACHED_USER_KEY, JSON.stringify(user)],
//     [CACHED_EMAIL_KEY, email.toLowerCase().trim()],
//     [CACHED_PW_HASH_KEY, hash],
//   ]);
// }

// /** Remove cached credentials (e.g. on logout). */
// export async function clearCachedCredentials(): Promise<void> {
//   await AsyncStorage.multiRemove([
//     CACHED_USER_KEY,
//     CACHED_EMAIL_KEY,
//     CACHED_PW_HASH_KEY,
//   ]);
// }

// /** Return the cached User if email + password match the stored hash. */
// async function tryOfflineLogin(
//   email: string,
//   password: string
// ): Promise<User | null> {
//   try {
//     const [[, cachedEmail], [, cachedHash], [, cachedUser]] =
//       await AsyncStorage.multiGet([
//         CACHED_EMAIL_KEY,
//         CACHED_PW_HASH_KEY,
//         CACHED_USER_KEY,
//       ]);

//     if (!cachedEmail || !cachedHash || !cachedUser) return null;
//     if (cachedEmail !== email.toLowerCase().trim()) return null;

//     const inputHash = await hashPassword(password, email);
//     if (inputHash !== cachedHash) return null;

//     return JSON.parse(cachedUser) as User;
//   } catch {
//     return null;
//   }
// }

// // ─── Public API ───────────────────────────────────────────────────────────────

// export interface SignInResult {
//   user: User;
//   offlineMode: boolean;
// }

// /**
//  * Attempts Supabase sign-in. If the device is offline (or Supabase throws a
//  * network error), falls back to locally-cached credentials.
//  *
//  * Throws if:
//  *  - Supabase returns an auth error (wrong password, user not found, etc.)
//  *  - Device is offline AND no cached credentials match.
//  */
// export async function signInOfflineAware(
//   email: string,
//   password: string
// ): Promise<SignInResult> {
//   // ── 1. Try Supabase ────────────────────────────────────────────────────────
//   try {
//     const data = await supabaseSignIn(email.trim().toLowerCase(), password);
//     const supaUser = data.user;

//     if (!supaUser) throw new Error("No user returned from Supabase.");

//     const meta = supaUser.user_metadata ?? {};
//     const user: User = {
//       id: supaUser.id,
//       full_name: meta.full_name ?? null,
//       phone: meta.phone ?? "",
//       email: supaUser.email ?? email,
//       age: meta.age ?? 18,
//       role: meta.role ?? "passenger",
//       driver_id: meta.driver_id,
//       profile_photo: meta.profile_photo,
//       vehicle_details: meta.vehicle_details,
//       park_location: meta.park_location,
//       park_name: meta.park_name,
//       points_balance: meta.points_balance ?? 0,
//       avg_rating: meta.avg_rating,
//       profile_complete: meta.profile_complete ?? false,
//       created_at: supaUser.created_at,
//     };

//     // Cache for future offline use
//     await cacheCredentials(user, email, password);

//     return { user, offlineMode: false };
//   } catch (err: unknown) {
//     // ── 2. Decide if this is a network failure or an auth failure ────────────
//     const message =
//       err instanceof Error ? err.message.toLowerCase() : "";

//     const isNetworkError =
//       message.includes("network") ||
//       message.includes("fetch") ||
//       message.includes("connect") ||
//       message.includes("offline") ||
//       message.includes("timeout") ||
//       message.includes("unable to resolve");

//     if (!isNetworkError) {
//       // Real auth error — surface it to the caller
//       throw err;
//     }

//     // ── 3. Offline fallback ──────────────────────────────────────────────────
//     const cachedUser = await tryOfflineLogin(email, password);
//     if (cachedUser) {
//       return { user: cachedUser, offlineMode: true };
//     }

//     throw new Error(
//       "You appear to be offline and no cached credentials were found. " +
//         "Please connect to the internet and try again."
//     );
//   }
// }


// // Add this export
// export async function signUpOfflineAware(
//   email: string,
//   password: string,
//   metadata: Record<string, unknown>
// ): Promise<{ user: User; offlineMode: boolean }> {
//   // Sign‑up always requires internet (can't create account offline)
//   try {
//     const data = await supabaseSignUp(email, password, metadata);
//     const supaUser = data.user;

//     if (!supaUser) {
//       throw new Error("No user returned from Supabase.");
//     }

//     // Build user object from metadata and Supabase response
//     const user: User = {
//       id: supaUser.id,
//       full_name: (metadata.full_name as string) ?? null,
//       phone: (metadata.phone as string) ?? "",
//       email: supaUser.email ?? email,
//       age: (metadata.age as number) ?? 18,
//       role: (metadata.role as any) ?? "passenger",
//       driver_id: metadata.driver_id as string | undefined,
//       profile_photo: metadata.profile_photo as string | undefined,
//       vehicle_details: metadata.vehicle_details as string | undefined,
//       park_location: metadata.park_location as string | undefined,
//       park_name: metadata.park_name as string | undefined,
//       points_balance: (metadata.points_balance as number) ?? 0,
//       avg_rating: metadata.avg_rating as number | undefined,
//       profile_complete: (metadata.profile_complete as boolean) ?? false,
//       created_at: supaUser.created_at,
//     };

//     // Cache credentials for offline login later
//     await cacheCredentials(user, email, password);

//     return { user, offlineMode: false };
//   } catch (error) {
//     // If network error, re‑throw with a user‑friendly message
//     const message =
//       error instanceof Error ? error.message.toLowerCase() : "";
//     const isNetworkError =
//       message.includes("network") ||
//       message.includes("fetch") ||
//       message.includes("connect") ||
//       message.includes("offline") ||
//       message.includes("timeout") ||
//       message.includes("unable to resolve");

//     if (isNetworkError) {
//       throw new Error(
//         "No internet connection. Please connect to the internet and try again."
//       );
//     }
//     // Otherwise, re‑throw the original error (e.g., duplicate email, etc.)
//     throw error;
//   }
// }








// // ─── ADD to src/services/auth.ts ─────────────────────────────────────────────
// // Paste at the bottom of the existing file.


// /**
//  * Persist credentials for biometric re-login after a successful password login.
//  * Production note: swap AsyncStorage for expo-secure-store here.
//  */
// export async function saveBiometricCredentials(
//   email: string,
//   password: string
// ): Promise<void> {
//   await AsyncStorage.multiSet([
//     [BIOMETRIC_EMAIL_KEY, email.toLowerCase().trim()],
//     [BIOMETRIC_PW_KEY, password],
//   ]);
// }

// export async function clearBiometricCredentials(): Promise<void> {
//   await AsyncStorage.multiRemove([BIOMETRIC_EMAIL_KEY, BIOMETRIC_PW_KEY]);
// }

// export async function getBiometricCredentials(): Promise<{ email: string; password: string } | null> {
//   const [[, email], [, pw]] = await AsyncStorage.multiGet([BIOMETRIC_EMAIL_KEY, BIOMETRIC_PW_KEY]);
//   if (!email || !pw) return null;
//   return { email, password: pw };
// }

// export interface BiometricLoginResult {
//   supported: boolean;
//   enrolled: boolean;
//   success: boolean;
//   user?: import("../models/types").User;
//   offlineMode?: boolean;
//   error?: string;
// }

// /**
//  * Attempt biometric authentication, then replay stored credentials if successful.
//  *
//  * Returns { success: false, error: "no_credentials" } if the user hasn't
//  * signed in with a password yet (biometric has nothing to replay).
//  */
// export async function signInWithBiometrics(): Promise<BiometricLoginResult> {
//   // Lazy import so the module isn't required on devices without it
//   let LocalAuthentication: typeof import("expo-local-authentication");
//   try {
//     LocalAuthentication = await import("expo-local-authentication");
//   } catch {
//     return { supported: false, enrolled: false, success: false };
//   }

//   const compatible = await LocalAuthentication.hasHardwareAsync();
//   if (!compatible) return { supported: false, enrolled: false, success: false };

//   const enrolled = await LocalAuthentication.isEnrolledAsync();
//   if (!enrolled) return { supported: true, enrolled: false, success: false };

//   const result = await LocalAuthentication.authenticateAsync({
//     promptMessage: "Sign in to Teqil",
//     fallbackLabel: "Use password",
//     cancelLabel: "Cancel",
//     disableDeviceFallback: false,
//   });

//   if (!result.success) {
//     return { supported: true, enrolled: true, success: false, error: result.error };
//   }

//   const creds = await getBiometricCredentials();
//   if (!creds) {
//     return { supported: true, enrolled: true, success: false, error: "no_credentials" };
//   }

//   try {
//     const { user, offlineMode } = await signInOfflineAware(creds.email, creds.password);
//     return { supported: true, enrolled: true, success: true, user, offlineMode };
//   } catch (err) {
//     return {
//       supported: true,
//       enrolled: true,
//       success: false,
//       error: err instanceof Error ? err.message : "auth_failed",
//     };
//   }
// }




/**
 * src/services/auth.ts
 *
 * Offline-aware authentication layer on top of Supabase.
 *
 * Key addition: after every successful signUp or profile update we also
 * upsert the row in public.users so driver_id is immediately searchable
 * without waiting for the Supabase trigger to fire.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { signUp as supabaseSignUp, signIn as supabaseSignIn, supabase } from "./supabase";
import { secureSet, secureDelete, secureGetWithLegacyMigration } from "./secureStore";
import type { User } from "../models/types";

// Sensitive keys → encrypted SecureStore (Keychain/Keystore).
const BIOMETRIC_EMAIL_KEY = "teqil_biometric_email";
const BIOMETRIC_PW_KEY    = "teqil_biometric_pw";
const CACHED_PW_HASH_KEY  = "teqil_cached_pw_hash";
// Non-secret profile cache → regular AsyncStorage.
const CACHED_USER_KEY     = "teqil_cached_user";
const CACHED_EMAIL_KEY    = "teqil_cached_email";

// ─── Simple deterministic hash (offline cache guard only) ─────────────────────
async function hashPassword(password: string, email: string): Promise<string> {
  const raw = `${email.toLowerCase().trim()}:${password}`;
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = (h * 33) ^ raw.charCodeAt(i);
    return (h >>> 0).toString(16);
  }
}

// ─── Username → account, without the account's email ──────────────────────────
//
// `checkUsernameExists` used to return the EMAIL behind any username to any
// caller, signed in or not, so that login could hand it to
// `signInWithPassword`. That made every handle a lookup key for an email
// address. It is gone; three narrower functions replace it, and none of them
// puts an email on the device.

/**
 * Is this handle free to claim?
 *
 * A boolean and nothing else. Signup inherently reveals whether a username is
 * taken — that is what the field is for — but it must not also reveal what is
 * attached to it. Anon-callable, because signup has no session.
 */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const uname = username.trim().toLowerCase().replace(/^@/, "");
  if (!uname) return false;
  const { data, error } = await supabase.rpc("username_available", { p_username: uname });
  if (error) {
    // Fail CLOSED. Reporting "available" on a network blip lets a second
    // account be created on a handle that is already taken, and the unique
    // index then rejects the signup after the user has filled in everything.
    console.warn("[auth] username_available:", error.message);
    throw new Error("Couldn't check that username. Check your connection and try again.");
  }
  return data === true;
}

/** Kept only so a stale import fails loudly rather than silently type-checking. */
export async function checkUsernameExists(username: string): Promise<never> {
  throw new Error(
    `checkUsernameExists is removed — it leaked the email behind "${username}". ` +
      "Use isUsernameAvailable() for signup, or signInWithUsername() to log in.",
  );
}

// ─── Sync a User object into public.users ─────────────────────────────────────
// Called after signup and after every profile update so that
// driver_id (and other fields) are immediately searchable via Supabase queries.
export async function syncUserToPublicTable(user: User): Promise<void> {
  try {
    await supabase.from("users").upsert(
      {
        id:               user.id,
        username:         user.username ?? null,
        first_name:       user.first_name ?? null,
        last_name:        user.last_name ?? null,
        full_name:        user.full_name,
        phone:            user.phone,
        email:            user.email,
        age:              user.age,
        role:             user.role,
        driver_id:        user.driver_id ?? null,
        profile_photo:    user.profile_photo ?? null,
        vehicle_details:  user.vehicle_details ?? null,
        park_location:    user.park_location ?? null,
        park_name:        user.park_name ?? null,
        points_balance:   user.points_balance ?? 0,
        credits_balance:  user.credits_balance ?? 0,
        device_fingerprint: user.device_fingerprint ?? null,
        avg_rating:       user.avg_rating ?? null,
        profile_complete: user.profile_complete ?? false,
        push_token:       user.push_token ?? null,
        payout_bank_code:      user.payout_bank_code ?? null,
        payout_account_number: user.payout_account_number ?? null,
        payout_account_name:   user.payout_account_name ?? null,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "id" }
    );
  } catch (err) {
    // Non-fatal: the trigger will handle it when the device is back online
    console.warn("[Auth] syncUserToPublicTable failed:", err);
  }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

export async function cacheCredentials(
  user: User,
  email: string,
  password: string
): Promise<void> {
  const hash = await hashPassword(password, email);
  // Profile + email are not secret → AsyncStorage. The password hash is → SecureStore.
  await AsyncStorage.multiSet([
    [CACHED_USER_KEY,  JSON.stringify(user)],
    [CACHED_EMAIL_KEY, email.toLowerCase().trim()],
  ]);
  await secureSet(CACHED_PW_HASH_KEY, hash);
}

export async function clearCachedCredentials(): Promise<void> {
  await AsyncStorage.multiRemove([CACHED_USER_KEY, CACHED_EMAIL_KEY]);
  await secureDelete(CACHED_PW_HASH_KEY);
}

async function tryOfflineLogin(
  email: string,
  password: string
): Promise<User | null> {
  try {
    const [[, cachedEmail], [, cachedUser]] = await AsyncStorage.multiGet([
      CACHED_EMAIL_KEY,
      CACHED_USER_KEY,
    ]);
    const cachedHash = await secureGetWithLegacyMigration(CACHED_PW_HASH_KEY);
    if (!cachedEmail || !cachedHash || !cachedUser) return null;
    if (cachedEmail !== email.toLowerCase().trim()) return null;
    const inputHash = await hashPassword(password, email);
    if (inputHash !== cachedHash) return null;
    return JSON.parse(cachedUser) as User;
  } catch {
    return null;
  }
}

// ─── Sign in ──────────────────────────────────────────────────────────────────

export interface SignInResult {
  user: User;
  offlineMode: boolean;
}

export async function signInOfflineAware(
  email: string,
  password: string
): Promise<SignInResult> {
  try {
    const data = await supabaseSignIn(email.trim().toLowerCase(), password);
    const supaUser = data.user;
    if (!supaUser) throw new Error("No user returned from Supabase.");

    const meta = supaUser.user_metadata ?? {};
    const user: User = {
      id:               supaUser.id,
      username:         meta.username ?? null,
      first_name:       meta.first_name ?? null,
      last_name:        meta.last_name ?? null,
      full_name:        meta.full_name ?? null,
      phone:            meta.phone ?? "",
      email:            supaUser.email ?? email,
      age:              meta.age ?? 18,
      role:             meta.role ?? "passenger",
      driver_id:        meta.driver_id,
      profile_photo:    meta.profile_photo,
      vehicle_details:  meta.vehicle_details,
      park_location:    meta.park_location,
      park_name:        meta.park_name,
      points_balance:   meta.points_balance ?? 0,
      credits_balance:  meta.credits_balance ?? 0,
      device_fingerprint: meta.device_fingerprint,
      avg_rating:       meta.avg_rating,
      profile_complete: meta.profile_complete ?? false,
      created_at:       supaUser.created_at,
    };

    await cacheCredentials(user, email, password);
    // Ensure public.users is up-to-date (trigger may not have fired yet)
    syncUserToPublicTable(user).catch(() => {});

    return { user, offlineMode: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    const isNetworkError =
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("connect") ||
      message.includes("offline") ||
      message.includes("timeout") ||
      message.includes("unable to resolve");

    if (!isNetworkError) throw err;

    const cachedUser = await tryOfflineLogin(email, password);
    if (cachedUser) return { user: cachedUser, offlineMode: true };

    throw new Error(
      "You appear to be offline and no cached credentials were found. " +
        "Please connect to the internet and try again."
    );
  }
}

// ─── Sign in by username ──────────────────────────────────────────────────────

/**
 * The login screen's entry point.
 *
 * The username → email step happens inside the `username-login` edge function
 * with the service-role key; what comes back is a session, which we install
 * locally. The device is never told which email address the account uses, so a
 * stolen anon key (it ships in the bundle — assume it is stolen) buys nothing.
 *
 * Offline still works: after one successful online login the email is in the
 * local credential cache, so a later sign-in with no network can be checked
 * against it exactly as the email path does.
 */
export async function signInWithUsername(
  username: string,
  password: string,
): Promise<SignInResult> {
  const uname = username.trim().toLowerCase().replace(/^@/, "");
  if (!uname) throw new Error("Enter your username to sign in.");

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("App is not configured for sign in.");

  let payload: any;
  try {
    const res = await fetch(`${url}/functions/v1/username-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon },
      body: JSON.stringify({ username: uname, password }),
    });
    payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error ?? "Wrong username or password.");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    const isNetworkError =
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("connect") ||
      message.includes("offline") ||
      message.includes("timeout") ||
      message.includes("unable to resolve");
    if (!isNetworkError) throw err;

    const cached = await tryOfflineLoginByUsername(uname, password);
    if (cached) return { user: cached, offlineMode: true };
    throw new Error(
      "You appear to be offline and no cached login was found for that username. " +
        "Please connect to the internet and try again.",
    );
  }

  // Install the session the function minted for us. Everything downstream —
  // RLS, realtime, the sync layer — reads the client's session, not this call.
  const { error: sessErr } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  if (sessErr) throw sessErr;

  const supaUser = payload.user;
  const meta = supaUser?.user_metadata ?? {};
  const user: User = {
    id:                 supaUser.id,
    username:           meta.username ?? uname,
    first_name:         meta.first_name ?? null,
    last_name:          meta.last_name ?? null,
    full_name:          meta.full_name ?? null,
    phone:              meta.phone ?? "",
    email:              supaUser.email ?? "",
    age:                meta.age ?? 18,
    role:               meta.role ?? "passenger",
    driver_id:          meta.driver_id,
    profile_photo:      meta.profile_photo,
    vehicle_details:    meta.vehicle_details,
    park_location:      meta.park_location,
    park_name:          meta.park_name,
    points_balance:     meta.points_balance ?? 0,
    credits_balance:    meta.credits_balance ?? 0,
    device_fingerprint: meta.device_fingerprint,
    avg_rating:         meta.avg_rating,
    profile_complete:   meta.profile_complete ?? false,
    created_at:         supaUser.created_at,
  };

  // The email is the cache key for offline login and for biometrics, and it is
  // the user's own address on their own device — which is a different thing
  // from handing it to a stranger who typed their handle.
  if (user.email) await cacheCredentials(user, user.email, password);
  syncUserToPublicTable(user).catch(() => {});

  return { user, offlineMode: false };
}

/**
 * Offline variant: match against the cached profile by username, then verify
 * the password against the cached hash (which is salted with the email, so the
 * cached email is what has to be used to recompute it).
 */
async function tryOfflineLoginByUsername(
  username: string,
  password: string,
): Promise<User | null> {
  try {
    const [[, cachedEmail], [, cachedUserRaw]] = await AsyncStorage.multiGet([
      CACHED_EMAIL_KEY,
      CACHED_USER_KEY,
    ]);
    if (!cachedEmail || !cachedUserRaw) return null;
    const cachedUser = JSON.parse(cachedUserRaw) as User;
    if ((cachedUser.username ?? "").toLowerCase() !== username) return null;
    return await tryOfflineLogin(cachedEmail, password);
  } catch {
    return null;
  }
}

/**
 * Ask for a reset link by username.
 *
 * Resolves nothing locally and always resolves successfully — the edge function
 * returns the same answer for a real handle and an invented one, so this cannot
 * be used to find out who has an account.
 */
/**
 * Send a reset link, given either a username or an email address.
 *
 * ── Why both ───────────────────────────────────────────────────────────────
 * This used to take a username only. Registration asks for an email and a
 * username, and the one people remember six months later is the email — so a
 * username-only reset locked out exactly the users who most needed it.
 *
 * ── Why the two paths differ ───────────────────────────────────────────────
 * An email goes straight to Supabase. A username cannot: resolving a handle to
 * an address requires reading `users`, which is not cross-readable and must not
 * become an "is this handle registered, and what is their email?" oracle. That
 * resolution happens inside the `username-reset` edge function with the service
 * key, and the function returns the same answer either way.
 *
 * Both paths are silent about whether the account exists. A reset form that
 * says "no such user" is an account-existence checker.
 */
export async function sendPasswordReset(handleOrEmail: string): Promise<void> {
  const raw = handleOrEmail.trim();
  if (!raw) throw new Error("Enter your username or email to reset your password.");

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw);

  if (isEmail) {
    const { error } = await supabase.auth.resetPasswordForEmail(raw.toLowerCase(), {
      redirectTo: "teqil://reset-password",
    });
    // Supabase deliberately succeeds for an unknown address; a network failure
    // is the only thing worth surfacing.
    if (error && !/user not found/i.test(error.message)) {
      throw new Error("Couldn't send the reset link. Please try again.");
    }
    return;
  }

  const uname = raw.toLowerCase().replace(/^@/, "");
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("App is not configured for password reset.");

  const res = await fetch(`${url}/functions/v1/username-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ username: uname, redirectTo: "teqil://reset-password" }),
  });
  if (!res.ok) throw new Error("Couldn't send the reset link. Please try again.");
}

/** @deprecated Use `sendPasswordReset`, which also accepts an email address. */
export async function sendPasswordResetForUsername(username: string): Promise<void> {
  return sendPasswordReset(username);
}

// ─── Sign up ──────────────────────────────────────────────────────────────────

export async function signUpOfflineAware(
  email: string,
  password: string,
  metadata: Record<string, unknown>
): Promise<{ user: User; offlineMode: boolean }> {
  try {
    const data = await supabaseSignUp(email, password, metadata);
    const supaUser = data.user;
    if (!supaUser) throw new Error("No user returned from Supabase.");

    const user: User = {
      id:               supaUser.id,
      username:         (metadata.username as string) ?? null,
      first_name:       (metadata.first_name as string) ?? null,
      last_name:        (metadata.last_name as string) ?? null,
      full_name:        (metadata.full_name as string) ?? null,
      phone:            (metadata.phone as string) ?? "",
      email:            supaUser.email ?? email,
      age:              (metadata.age as number) ?? 18,
      role:             (metadata.role as any) ?? "passenger",
      driver_id:        metadata.driver_id as string | undefined,
      profile_photo:    metadata.profile_photo as string | undefined,
      vehicle_details:  metadata.vehicle_details as string | undefined,
      park_location:    metadata.park_location as string | undefined,
      park_name:        metadata.park_name as string | undefined,
      points_balance:   (metadata.points_balance as number) ?? 0,
      credits_balance:  (metadata.credits_balance as number) ?? 10,
      device_fingerprint: metadata.device_fingerprint as string | undefined,
      avg_rating:       metadata.avg_rating as number | undefined,
      profile_complete: (metadata.profile_complete as boolean) ?? false,
      created_at:       supaUser.created_at,
    };

    await cacheCredentials(user, email, password);
    // Write to public.users immediately so driver_id is searchable right away
    await syncUserToPublicTable(user);

    return { user, offlineMode: false };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const isNetworkError =
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("connect") ||
      message.includes("offline") ||
      message.includes("timeout") ||
      message.includes("unable to resolve");

    if (isNetworkError) {
      throw new Error(
        "No internet connection. Please connect to the internet and try again."
      );
    }
    throw error;
  }
}

// ─── Biometric helpers ────────────────────────────────────────────────────────

export async function saveBiometricCredentials(
  email: string,
  password: string
): Promise<void> {
  // Both are stored in the encrypted Keychain/Keystore, never plaintext.
  await secureSet(BIOMETRIC_EMAIL_KEY, email.toLowerCase().trim());
  await secureSet(BIOMETRIC_PW_KEY, password);
}

export async function clearBiometricCredentials(): Promise<void> {
  await secureDelete(BIOMETRIC_EMAIL_KEY);
  await secureDelete(BIOMETRIC_PW_KEY);
}

export async function getBiometricCredentials(): Promise<{
  email: string;
  password: string;
} | null> {
  // Migrates any legacy plaintext-AsyncStorage credentials into SecureStore on read.
  const email = await secureGetWithLegacyMigration(BIOMETRIC_EMAIL_KEY);
  const pw = await secureGetWithLegacyMigration(BIOMETRIC_PW_KEY);
  if (!email || !pw) return null;
  return { email, password: pw };
}

export interface BiometricLoginResult {
  supported: boolean;
  enrolled: boolean;
  success: boolean;
  user?: User;
  offlineMode?: boolean;
  error?: string;
}

export async function signInWithBiometrics(): Promise<BiometricLoginResult> {
  let LocalAuthentication: typeof import("expo-local-authentication");
  try {
    LocalAuthentication = await import("expo-local-authentication");
  } catch {
    return { supported: false, enrolled: false, success: false };
  }

  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return { supported: false, enrolled: false, success: false };

  const enrolled = await LocalAuthentication.isEnrolledAsync();

  // Attempt authentication even when Face ID / Touch ID isn't enrolled — with
  // disableDeviceFallback:false the OS falls back to the device passcode.
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage:        "Sign in to Teqil",
    fallbackLabel:        "Use passcode",
    cancelLabel:          "Cancel",
    disableDeviceFallback: false,
  });

  if (!result.success) {
    return {
      supported: true,
      enrolled,
      success: false,
      error: result.error,
    };
  }

  const creds = await getBiometricCredentials();
  if (!creds) {
    return {
      supported: true,
      enrolled: true,
      success: false,
      error: "no_credentials",
    };
  }

  try {
    const { user, offlineMode } = await signInOfflineAware(
      creds.email,
      creds.password
    );
    return { supported: true, enrolled: true, success: true, user, offlineMode };
  } catch (err) {
    return {
      supported: true,
      enrolled: true,
      success: false,
      error: err instanceof Error ? err.message : "auth_failed",
    };
  }
}