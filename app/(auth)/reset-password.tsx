/**
 * app/(auth)/reset-password.tsx
 *
 * Landing screen for the Supabase password-reset email link
 * (redirectTo: "teqil://reset-password").
 *
 * Flow:
 *  1. The recovery link opens the app with access/refresh tokens in the URL.
 *     We parse them and establish a recovery session (this IS the email
 *     verification step).
 *  2. The user sets a new password and may also change their username — allowed
 *     only here, i.e. after the email has been verified.
 *  3. On success we sign out and send them to login with the new credentials.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Colors } from "@/constants/colors";
import { supabase } from "@/src/services/supabase";
import { isUsernameAvailable } from "@/src/services/auth";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { iosAlert } from "@/components/ios";
import { checkPassword, NO_AUTOFILL, MIN_LENGTH } from "@/src/services/password";

/** Extract key/value pairs from a deep-link URL's query string AND fragment. */
function parseAuthParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const hashIdx = url.indexOf("#");
  const qIdx = url.indexOf("?");
  const fragment = hashIdx >= 0 ? url.slice(hashIdx + 1) : "";
  const query =
    qIdx >= 0 ? url.slice(qIdx + 1, hashIdx >= 0 ? hashIdx : undefined) : "";

  for (const part of [query, fragment]) {
    if (!part) continue;
    for (const kv of part.split("&")) {
      const [k, v] = kv.split("=");
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }
  return out;
}

export default function ResetPasswordScreen() {
  const { theme } = useSettingsStore();
  const isDark = theme === "dark";
  const bg = isDark ? Colors.background : Colors.textWhite;
  const textColor = isDark ? Colors.textWhite : Colors.text;
  const subTextColor = isDark ? Colors.textSecondary : Colors.textTertiary;
  const fieldBg = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";
  const primaryBtn = isDark ? "rgba(255,255,255,0.08)" : Colors.text;

  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false); // recovery session established

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Establish the recovery session from the incoming deep link.
  useEffect(() => {
    let mounted = true;

    const establish = async (raw?: string | null): Promise<boolean> => {
      if (!raw) return false;
      const p = parseAuthParams(raw);
      if (p.access_token && p.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: p.access_token,
          refresh_token: p.refresh_token,
        });
        if (!error && mounted) {
          setReady(true);
          return true;
        }
      }
      return false;
    };

    (async () => {
      // Web / already-detected sessions arrive here with a live session.
      const { data } = await supabase.auth.getSession();
      if (data.session && mounted) {
        setReady(true);
      } else {
        const initial = await Linking.getInitialURL();
        await establish(initial);
      }
      if (mounted) setChecking(false);
    })();

    const linkSub = Linking.addEventListener("url", ({ url }) => {
      establish(url);
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && mounted) {
        setReady(true);
        setChecking(false);
      }
    });

    return () => {
      mounted = false;
      linkSub.remove();
      authSub.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = useCallback(async () => {
    // The SAME rules registration enforces. A reset that accepts a weaker
    // password than signup does is not a smaller problem than a weak signup —
    // it is a bigger one, because reset is the path an attacker who already
    // controls the mailbox will use.
    const check = checkPassword(password, { username: newUsername.trim() || undefined });
    if (!check.acceptable) {
      iosAlert("Password not strong enough", check.advice ?? `Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      iosAlert("Passwords don't match", "Please re-enter the same password.");
      return;
    }
    const uname = newUsername.trim().toLowerCase();
    setLoading(true);
    try {
      // If they want a new username, make sure it's free first.
      if (uname) {
        const taken = !(await isUsernameAvailable(uname));
        if (taken) {
          setLoading(false);
          iosAlert("Username taken", `"${uname}" is already in use.`);
          return;
        }
      }

      const { data, error } = await supabase.auth.updateUser({
        password,
        ...(uname ? { data: { username: uname } } : {}),
      });
      if (error) throw error;

      // Mirror the username into public.users so lookups stay in sync.
      if (uname && data.user) {
        await supabase
          .from("users")
          .update({ username: uname, updated_at: new Date().toISOString() })
          .eq("id", data.user.id);
      }

      await supabase.auth.signOut();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      iosAlert(
        "All set",
        uname
          ? "Your password and username were updated. Please sign in."
          : "Your password was updated. Please sign in."
      );
      router.replace("/(auth)/login");
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      iosAlert("Couldn't update", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [password, confirm, newUsername]);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.replace("/(auth)/login")}>
          <Ionicons name="chevron-back" size={22} color={textColor} />
        </Pressable>
        <View style={styles.pageHeaderContainer}>
          <Text style={[styles.pageTitle, { color: textColor }]}>Reset Password</Text>
          <Text style={[styles.pageSubtitle, { color: subTextColor }]}>
            Set a new password for your account
          </Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {checking ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={[styles.centerText, { color: subTextColor }]}>Verifying your reset link…</Text>
        </View>
      ) : !ready ? (
        <View style={styles.center}>
          <View style={[styles.iconBadge, { backgroundColor: "rgba(220,38,38,0.12)" }]}>
            <Ionicons name="link-outline" size={30} color={Colors.error} />
          </View>
          <Text style={[styles.centerTitle, { color: textColor }]}>Link expired or invalid</Text>
          <Text style={[styles.centerText, { color: subTextColor }]}>
            Open the most recent reset link from your email, or request a new one from the login
            screen.
          </Text>
          <Pressable
            style={[styles.submitBtn, { backgroundColor: primaryBtn, marginTop: 24, alignSelf: "stretch" }]}
            onPress={() => router.replace("/(auth)/login")}
          >
            <Text style={styles.submitBtnText}>Back to login</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={[styles.label, { color: textColor }]}>New password</Text>
          <View style={[styles.inputRow, { backgroundColor: fieldBg }]}>
            <Ionicons name="lock-closed-outline" size={20} color={subTextColor} style={styles.icon} />
            <TextInput
              style={[styles.input, { color: textColor }]}
              placeholder="At least 8 characters"
              placeholderTextColor={subTextColor}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={subTextColor}
              />
            </Pressable>
          </View>

          <Text style={[styles.label, { color: textColor }]}>Confirm password</Text>
          <View style={[styles.inputRow, { backgroundColor: fieldBg }]}>
            <Ionicons name="shield-checkmark-outline" size={20} color={subTextColor} style={styles.icon} />
            <TextInput
              style={[styles.input, { color: textColor }]}
              placeholder="Re-enter password"
              placeholderTextColor={subTextColor}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <Text style={[styles.label, { color: textColor }]}>New username (optional)</Text>
          <View style={[styles.inputRow, { backgroundColor: fieldBg }]}>
            <Ionicons name="at-outline" size={20} color={subTextColor} style={styles.icon} />
            <TextInput
              style={[styles.input, { color: textColor }]}
              placeholder="Leave blank to keep current"
              placeholderTextColor={subTextColor}
              value={newUsername}
              onChangeText={(v) => setNewUsername(v.replace(/\s/g, "").toLowerCase())}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
            />
          </View>
          <Text style={[styles.hint, { color: subTextColor }]}>
            You can change your username now that your email is verified.
          </Text>

          <Pressable
            style={[styles.submitBtn, { backgroundColor: primaryBtn }, loading && { opacity: 0.7 }]}
            onPress={onSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Update password</Text>
            )}
          </Pressable>
        </View>
      )}
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
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 24, paddingTop: 24 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  iconBadge: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  centerTitle: { fontFamily: "Poppins_700Bold", fontSize: 18, textAlign: "center" },
  centerText: { fontFamily: "Poppins_400Regular", fontSize: 13, textAlign: "center", lineHeight: 20 },
  label: {
    fontFamily: "Poppins_500Medium",
    fontSize: 13,
    marginTop: 16,
    marginBottom: 7,
    paddingLeft: 5,
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
  hint: {
    fontFamily: "Poppins_400Regular",
    fontSize: 12,
    marginTop: 8,
    paddingLeft: 5,
    lineHeight: 18,
  },
  submitBtn: {
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 28,
  },
  submitBtnText: { fontFamily: "Poppins_600SemiBold", fontSize: 16, color: "#fff" },
});
