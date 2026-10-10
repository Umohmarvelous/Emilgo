/**
 * app/(auth)/login.tsx
 *
 * Password-based login ("secure but easy and fast"):
 * - On a device that has logged in before, we already know the account, so the
 *   screen just asks for the PASSWORD (plus a Face ID / Touch ID button).
 * - On a fresh device (nothing stored), we ask for the username once to identify
 *   the account (resolved to an email via get_user_by_username), then password.
 * - Biometric button: expo-local-authentication (Face ID / Touch ID, with device
 *   passcode fallback) replays the stored credentials for a real Supabase session.
 * - On success we (re)store the device fingerprint so this device is remembered.
 * - Forgot password: username → email → Supabase reset link.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
  Modal,
  Keyboard,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";

import { useAuthStore } from "@/src/store/useStore";
import { Colors } from "@/constants/colors";
import {
  signInWithUsername,
  sendPasswordReset,
  signInOfflineAware,
  saveBiometricCredentials,
  signInWithBiometrics,
  getBiometricCredentials,
  syncUserToPublicTable,
} from "@/src/services/auth";
import { rememberAccount } from "@/src/services/accounts";
import { supabase } from "@/src/services/supabase";
import { getDeviceFingerprint } from "@/src/utils/device";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import type { User } from "@/src/models/types";
import { iosAlert, IOSAppFont, useIOSTheme } from "@/components/ios";

// ─── Role → route helper ──────────────────────────────────────────────────────

function routeByRole(role: string, profileComplete: boolean | undefined) {
  // if (role === "driver") {
  //   return profileComplete ? "/(main)" : "/(auth)/driver-profile";
  // }
  return "/(main)";
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LoginScreen() {
  const iosTheme = useIOSTheme()

  const params = useLocalSearchParams<{ add?: string }>();
  const { theme } = useSettingsStore();
  const isDark = theme === "dark";
  const bg = isDark ? Colors.background : Colors.textWhite;
  const textColor = isDark ? Colors.textWhite : Colors.text;
  const subTextColor = isDark ? Colors.textSecondary : Colors.textTertiary;
  const fieldBg = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";
  const primaryBtn = isDark ? "rgba(255,255,255,0.08)" : Colors.text;
    const cardBg = isDark ? "rgba(255,255,255,0.08)" : "#FFFFFF";


  const insets = useSafeAreaInsets();
  const { setUser, setIsAuthenticated } = useAuthStore();

  // Account this device already knows (from registration / a prior login).
  const [knownEmail, setKnownEmail] = useState<string | null>(null);
  const [hasStoredCreds, setHasStoredCreds] = useState(false);

  const [username, setUsername] = useState(""); // only when device is unknown
  const [password, setPassword] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);

  // Forgot-password modal
  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  // Load the device's stored account on mount.
  useEffect(() => {
    (async () => {
      const creds = await getBiometricCredentials();
      if (creds) {
        setKnownEmail(creds.email);
        setHasStoredCreds(true);
      }
    })();
  }, []);

  // ── Entrance animation ────────────────────────────────────────────────────
  const formOpacity = useSharedValue(0);
  const formY = useSharedValue(20);
  useEffect(() => {
    formOpacity.value = withDelay(150, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    formY.value = withDelay(150, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, [formOpacity, formY]);
  const formAnimStyle = useAnimatedStyle(() => ({
    opacity: formOpacity.value,
    transform: [{ translateY: formY.value }],
  }));

  // ── Complete a successful login ────────────────────────────────────────────
  const finishLogin = useCallback(
    async (user: User, offlineMode?: boolean) => {
      // Remember this device (fingerprint) for future logins.
      try {
        const fp = await getDeviceFingerprint();
        user.device_fingerprint = fp;
        syncUserToPublicTable(user).catch(() => {});
      } catch {
        /* fingerprint best-effort */
      }
      // Add this account to the device's picker so the avatar menu can switch
      // back to it without a password. No-ops when there is no session to save,
      // which is exactly the offline-cache path below.
      rememberAccount(user).catch(() => {
        /* the picker is a convenience; never block a successful login on it */
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setUser(user);
      setIsAuthenticated(true);
      // if (offlineMode) {
      //   iosAlert("Offline Mode", "Signed in from cache. Some features need internet.");
      // }
      router.replace(routeByRole(user.role, user.profile_complete) as any);
    },
    [setUser, setIsAuthenticated]
  );


  // ── Password sign-in ───────────────────────────────────────────────────────
  const handleSignIn = useCallback(async () => {
    if (!password) {
      iosAlert("Password required", "Please enter your password.");
      return;
    }
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      // Two paths, and the difference is which identifier we already hold.
      // `knownEmail` means this device has signed this account in before, so
      // the email is already cached locally and there is nothing to resolve.
      // Otherwise the username goes to the edge function, which resolves it
      // server-side — the email never travels to the device.
      const { user, offlineMode } = knownEmail && !showEmail
        ? await signInOfflineAware(knownEmail, password)
        : await signInWithUsername(username, password);

      // Enable instant biometric login next time on this device.
      const emailForBiometrics = knownEmail ?? user.email;
      if (emailForBiometrics) await saveBiometricCredentials(emailForBiometrics, password);
      await finishLogin(user, offlineMode);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      iosAlert(
        "Sign In Failed",
        err instanceof Error ? err.message : "Wrong password. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, [password, knownEmail, username, finishLogin]);

  // ── Biometric sign-in ──────────────────────────────────────────────────────
  const handleBiometric = useCallback(async () => {
    setBioLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const r = await signInWithBiometrics();

      if (!r.supported) {
        iosAlert("Not Supported", "Biometric authentication isn't available on this device.");
        return;
      }
      if (r.success && r.user) {
        await finishLogin(r.user, r.offlineMode);
        return;
      }
      if (r.error === "no_credentials") {
        iosAlert(
          "No Saved Login",
          "Sign in with your password once. After that, Face ID / passcode login will be available."
        );
      }
      // Any other error (user cancelled, failed) → stay on screen silently.
    } catch {
      iosAlert("Error", "Authentication failed. Please try again.");
    } finally {
      setBioLoading(false);
    }
  }, [finishLogin]);

  // ── Forgot password ────────────────────────────────────────────────────────
  const openForgot = useCallback(() => {
    setForgotUsername(username);
    setForgotVisible(true);
  }, [username]);

  const handleForgotSubmit = useCallback(async () => {
    const entered = forgotUsername.trim();
    if (!entered) {
      iosAlert("Enter your details", "Type your username or the email you signed up with.");
      return;
    }
    setForgotLoading(true);
    try {
      // Always the same answer, whether or not the account exists — a reset
      // form that says "no such user" is an account-existence checker.
      await sendPasswordReset(entered);
      setForgotVisible(false);
      iosAlert(
        "Reset link sent",
        "If that account exists, a reset link is on its way to the email on file. It expires in an hour."
      );
    } catch (err) {
      iosAlert(
        "Couldn't Send Reset",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setForgotLoading(false);
    }
  }, [forgotUsername]);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const busy = loading || bioLoading;

  // "Add an account" from the account menu lands here. The flag has to survive
  // the hop to Sign Up, or a user trying to add a SECOND account (a driver
  // login next to their passenger one) is silently sent through the first-time
  // registration path and signed out of the account they already had.
  const addingAccount = params.add === "1";

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { paddingTop: topPadding + 1 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.dismissTo("/(main)")}>
          <Ionicons name="chevron-back" size={22} color={textColor} />
        </Pressable>
        <View style={styles.pageHeaderContainer}>
          <Text style={[styles.pageTitle, { color: textColor }]}>Login</Text>
          <Text style={[styles.pageSubtitle, { color: subTextColor }]}>
            {addingAccount
              ? "Sign in to the account you want to add"
              : knownEmail
                ? "Welcome back — enter your password"
                : "Sign in to continue your journey"}
          </Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <Animated.View style={[styles.body, formAnimStyle]}>
        {!(knownEmail && showEmail) && (
          <Text style={[styles.account, { color: subTextColor }]} numberOfLines={1}>
            {knownEmail}
          </Text>
        )}


        {/* Username — only needed when this device has no stored account */}
        {/* {!knownEmail && ( */}
        {showEmail && (
          <>
            <Text style={[styles.label, { color: textColor }]}>Username</Text>
            <View style={[styles.inputRow, { backgroundColor: fieldBg }]}>
              <Ionicons name="at-outline" size={20} color={subTextColor} style={styles.icon} />
              <TextInput
                style={[styles.input, { color: textColor }]}
                placeholder="Enter your username"
                placeholderTextColor={subTextColor}
                value={username}
                onChangeText={(v) => setUsername(v.replace(/\s/g, "").toLowerCase())}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!busy}
              />
            </View>
          </>
        )}


        {/* Password + biometric button */}
        <Text style={[styles.label, { color: textColor }]}>Password</Text>
        <View style={styles.passwordRow}>
          <View style={[styles.inputRow, styles.passwordInput, { backgroundColor: fieldBg, borderColor: primaryBtn }]}>
            <Ionicons name="lock-closed-outline" size={20} color={subTextColor} style={styles.icon} />
            <TextInput
              ref={passwordRef}
              style={[styles.input, { color: textColor }]}
              placeholder="Enter your password"
              placeholderTextColor={subTextColor}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
              editable={!busy}
            />
            <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={subTextColor}
              />
            </Pressable>
          </View>

          {/* Round Face ID / biometric button */}
          <Pressable
            style={[
              styles.bioBtn,
              { borderColor: primaryBtn, backgroundColor: fieldBg },
              !hasStoredCreds && { opacity: 0.45 },
            ]}
            onPress={handleBiometric}
            disabled={bioLoading || !hasStoredCreds}
            hitSlop={6}
          >
            {bioLoading ? (
              <ActivityIndicator size="small" color={textColor} />
            ) : (
              <Ionicons name="finger-print" size={26} color={textColor} />
            )}
          </Pressable>
        </View>

        {/* Forgot password */}
        <Pressable style={styles.forgotBtn} onPress={openForgot} hitSlop={8}>
          <Text style={[styles.forgotText, { color: subTextColor }]}>Forgot password?</Text>
        </Pressable>

        {/* Sign in */}
        <Pressable
          style={[styles.submitBtn, { backgroundColor: primaryBtn }, busy && { opacity: 0.7 }]}
          onPress={handleSignIn}
          disabled={busy}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Sign In</Text>
          )}
        </Pressable>

        <View style={{marginTop: 30, alignSelf: 'center', justifyContent: 'flex-start', height: 'auto', gap: 20}}>
          <View  style={styles.switchBtn}>
            <Text style={[styles.switchText, { color: subTextColor }]}>
              {addingAccount ? "Need a new one? " : "Don't have an account? "}
            </Text>
            <Pressable
              onPress={() =>
                router.replace(addingAccount ? "/(auth)/register?add=1" : "/(auth)/register")
              }
            >
              <Text style={[styles.switchLink, { color: textColor }]}>
                {addingAccount ? "Create an account" : "Sign Up"}
              </Text>
            </Pressable>
          </View>

  
          <Pressable
          style={[{ width: 'auto', alignItems:'center', justifyContent: 'center' }]}
            onPress={() => setShowEmail((s) => !s)} hitSlop={8}
          >
            <Text style={{...IOSAppFont.callout, fontFamily: "Poppins_700Bold", padding: 0, margin:0, color: iosTheme.systemGreen}}>Use a different account</Text>
          </Pressable>
        </View>

        
      </Animated.View>


      {/* Forgot password modal */}
      <Modal
        transparent
        visible={forgotVisible}
        animationType="fade"
        onRequestClose={() => setForgotVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setForgotVisible(false)}>
          <Animated.View
            entering={FadeIn}
            exiting={FadeOut}
            style={[styles.sheet, { backgroundColor: isDark ? Colors.primaryDarker ?? "#0B2A18" : "#FFFFFF" }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.sheetIcon, { backgroundColor: "rgba(0,154,67,0.12)" }]}>
              <Ionicons name="key-outline" size={26} color={Colors.primary} />
            </View>
            <Text style={[styles.sheetTitle, { color: textColor }]}>Reset your password</Text>
            <Text style={[styles.sheetSub, { color: subTextColor }]}>
              Enter your username or the email you signed up with. We&apos;ll send a reset
              link to the address on file.
            </Text>
            <View style={[styles.inputRow, styles.sheetInput, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F5F7FA" }]}>
              <Ionicons name="at-outline" size={20} color={subTextColor} style={styles.icon} />
              <TextInput
                style={[styles.input, { color: textColor }]}
                placeholder="Username or email"
                placeholderTextColor={subTextColor}
                value={forgotUsername}
                onChangeText={(v) => setForgotUsername(v.replace(/\s/g, "").toLowerCase())}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={50}
                returnKeyType="done"
                onSubmitEditing={handleForgotSubmit}
              />
            </View>
            <Pressable
              style={[styles.sheetBtn, { backgroundColor: primaryBtn }, forgotLoading && { opacity: 0.7 }]}
              onPress={handleForgotSubmit}
              disabled={forgotLoading}
            >
              {forgotLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.sheetBtnText}>Send reset link</Text>
              )}
            </Pressable>
            <Pressable style={styles.sheetDismiss} onPress={() => setForgotVisible(false)}>
              <Text style={[styles.sheetDismissText, { color: subTextColor }]}>Cancel</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  pageHeaderContainer: { alignItems: "center" },
  pageTitle: { fontFamily: "Poppins_700Bold", fontSize: 20, marginBottom: 3 },
  pageSubtitle: { fontFamily: "Poppins_400Regular", fontSize: 12 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { paddingHorizontal: 24, paddingTop: 80, flex:1 },
  label: {
    fontFamily: "Poppins_500Medium",
    fontSize: 13,
    marginTop: 16,
    marginBottom: 7,
    paddingLeft: 5,
  },
  account: {
    fontFamily: "Poppins_500Medium",
    fontSize: 13,
    paddingLeft: 5,
    marginTop: 2,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  icon: { marginRight: 12 },
  input: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 15 },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  passwordInput: { flex: 1, borderWidth: .4 },
  bioBtn: {
    width: 50,
    height: 50,
    borderRadius: 9,
    borderWidth: .4,
    alignItems: "center",
    justifyContent: "center",
  },
  forgotBtn: { alignSelf: "flex-end", marginTop: 14 },
  forgotText: { fontFamily: "Poppins_500Medium", fontSize: 13 },
  submitBtn: {
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 100,
  },
  submitBtnText: { fontFamily: "Poppins_600SemiBold", fontSize: 16, color: "#fff" },
  switchBtn: { alignItems: "center",   paddingVertical: 8, flexDirection: 'row', gap: 2 },
  switchText: { fontFamily: "Poppins_400Regular", fontSize: 14 },
  switchLink: { fontFamily: "Poppins_700Bold", fontSize: 13 },

  // Modal
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  sheet: {
    width: "100%",
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    gap: 12,
  },
  sheetIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  sheetTitle: { fontFamily: "Poppins_700Bold", fontSize: 18, textAlign: "center" },
  sheetSub: {
    fontFamily: "Poppins_400Regular",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
  sheetInput: { width: "100%", marginTop: 6 },
  sheetBtn: {
    height: 52,
    borderRadius: 14,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  sheetBtnText: { fontFamily: "Poppins_600SemiBold", fontSize: 15, color: "#fff" },
  sheetDismiss: { paddingVertical: 6 },
  sheetDismissText: { fontFamily: "Poppins_400Regular", fontSize: 13 },
});
