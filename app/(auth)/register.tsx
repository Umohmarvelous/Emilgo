/**
 * app/(auth)/register.tsx
 *
 * Registration, as a four-step wizard.
 *
 * ── What changed, and why ──────────────────────────────────────────────────
 * This was one long scrolling form with eight fields, a Google button, an Apple
 * button, and a modal that offered to GENERATE the user's password. Four things
 * were wrong with it:
 *
 *  1. **The email was never verified.** `signUp()` created a working account and
 *     mailed a confirmation nobody had to open. Since this app carries chat,
 *     trip history and coins, an unverified address is a permanent account-theft
 *     hole: whoever really owns that mailbox can reset the password whenever
 *     they like. Verification now happens BEFORE the account is usable.
 *
 *  2. **The password was suggested, not chosen.** On focus, a modal offered a
 *     generated password and iOS offered its own on top. Both are gone — the
 *     user types their own, autofill is switched off on every password field
 *     (`NO_AUTOFILL`), and the rules are stricter to compensate.
 *
 *  3. **Confirm-password sat there from the first frame**, so people typed into
 *     it before they had settled on a password and then had to fix both. It is
 *     revealed only once the password passes every rule.
 *
 *  4. **Three roles were offered** and only two exist as a signup path. Park
 *     Owner is an operator account, not something you self-serve into.
 *
 * ── Why a wizard ───────────────────────────────────────────────────────────
 * Eight required fields on one screen is eight chances to be wrong at once, and
 * the error summary lands after the submit. Four short steps each fail on their
 * own, immediately, next to the thing that is wrong.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  FadeInDown,
  Easing,
} from "react-native-reanimated";

import { Colors } from "@/constants/colors";
import { useAuthStore } from "@/src/store/useStore";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { isUsernameAvailable, saveBiometricCredentials } from "@/src/services/auth";
import { rememberAccount } from "@/src/services/accounts";
import { applyPendingReferral } from "@/src/services/referrals";
import {
  generateDriverIdFromUsername,
  generateInitialsAvatar,
} from "@/src/utils/helpers";
import { getDeviceFingerprint } from "@/src/utils/device";
import { supabase } from "@/src/services/supabase";
import { checkPassword, NO_AUTOFILL } from "@/src/services/password";
import {
  sendCode,
  verifyCode,
  finishSignUp,
  abandon,
  CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
} from "@/src/services/emailVerification";
import { currencyForCountry, COUNTRIES } from "@/src/services/currency";
import type { UserRole } from "@/src/models/types";
import { iosAlert } from "@/components/ios";

// ─── The steps ───────────────────────────────────────────────────────────────

type Step = "role" | "you" | "email" | "password";
const ORDER: Step[] = ["role", "you", "email", "password"];

/**
 * Only two.
 *
 * Park Owner used to be here. It is an operator account — a park is onboarded by
 * agreement, its drivers are attached to it, and it can see other people's
 * trips. That is not something anyone should be able to self-serve into by
 * tapping a card, and the screens behind it assume a park exists.
 */
const ROLES: {
  value: UserRole;
  label: string;
  blurb: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    value: "passenger",
    label: "Regular User",
    blurb: "Find trips, pay half the fare, and track the ride.",
    icon: "person",
  },
  {
    value: "driver",
    label: "Emilgo For Business",
    blurb: "Carry passengers, earn coins, and get your fuel benefit.",
    icon: "car-sport",
  },
];

// ─── Form field ──────────────────────────────────────────────────────────────

function FormField({
  label, icon, placeholder, value, onChangeText, error, hint,
  secureTextEntry, keyboardType = "default", autoCapitalize = "none",
  rightElement, inputRef, returnKeyType, onSubmitEditing, maxLength,
  autoComplete, textContentType, noAutofill,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string | null;
  hint?: string | null;
  secureTextEntry?: boolean;
  keyboardType?: "email-address" | "default" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  rightElement?: React.ReactNode;
  inputRef?: React.RefObject<TextInput | null>;
  returnKeyType?: "next" | "done" | "go";
  onSubmitEditing?: () => void;
  maxLength?: number;
  autoComplete?: string;
  textContentType?: any;
  /** Switch off every password manager and suggestion path. */
  noAutofill?: boolean;
}) {
  const { theme } = useSettingsStore();
  const isDark = theme === "dark";
  const textColor = isDark ? Colors.textWhite : Colors.text;
  const subTextColor = isDark ? Colors.textSecondary : Colors.textTertiary;
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";

  return (
    <View style={fieldStyles.wrap}>
      <Text style={[fieldStyles.label, { color: textColor }]}>{label}</Text>
      <View
        style={[
          fieldStyles.inputRow,
          { backgroundColor: borderColor, borderColor: error ? Colors.error : borderColor },
        ]}
      >
        <Ionicons name={icon} size={20} color={subTextColor} style={fieldStyles.icon} />
        <TextInput
          ref={inputRef}
          // Spread FIRST so the explicit props below win where they overlap.
          // They set the same values NO_AUTOFILL does for a password field; what
          // matters is the part that has no explicit prop — `textContentType`,
          // `passwordRules` and `importantForAutofill`, which are what actually
          // switch the suggestion and generator off.
          {...(noAutofill ? NO_AUTOFILL : {})}
          style={[fieldStyles.input, { color: textColor }]}
          placeholder={placeholder}
          placeholderTextColor={subTextColor}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={returnKeyType === "done"}
          maxLength={maxLength}
          {...(!noAutofill && autoComplete ? { autoComplete: autoComplete as any } : {})}
          {...(!noAutofill && textContentType ? { textContentType } : {})}
          {...Platform.select({
            web: { style: [fieldStyles.input, { color: textColor, outlineStyle: "none" } as any] },
          })}
        />
        {rightElement}
      </View>
      {error ? (
        <Text style={[fieldStyles.errorText, { color: Colors.error }]}>{error}</Text>
      ) : hint ? (
        <Text style={[fieldStyles.hintText, { color: subTextColor }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: { marginBottom: 4 },
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
    borderRadius: 9,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: .5,
  },
  icon: { marginRight: 12 },
  input: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 15 },
  errorText: { fontFamily: "Poppins_400Regular", fontSize: 12, marginTop: 4, paddingLeft: 5 },
  hintText: { fontFamily: "Poppins_400Regular", fontSize: 12, marginTop: 4, paddingLeft: 5 },
});

// ─── Password strength ───────────────────────────────────────────────────────

/**
 * The meter, and the rules as a checklist.
 *
 * A bare coloured bar tells someone their password is "weak" and nothing about
 * what to do, so the rules are listed and tick off as they are met. The bar is
 * transform-only (`scaleX`), because animating width causes a layout pass on
 * every keystroke.
 */
function PasswordMeter({
  password, context,
}: {
  password: string;
  context: { email?: string; username?: string; firstName?: string; lastName?: string };
}) {
  const { theme } = useSettingsStore();
  const isDark = theme === "dark";
  const subTextColor = isDark ? Colors.textSecondary : Colors.textTertiary;
  const trackColor = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";

  const check = useMemo(() => checkPassword(password, context), [password, context]);
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withTiming(check.score / 4, { duration: 220 });
  }, [check.score, fill]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.02, fill.value) }],
  }));

  const colour =
    check.score >= 4 ? Colors.primary
    : check.score === 3 ? "#3FA34D"
    : check.score === 2 ? Colors.gold
    : Colors.error;

  if (!password) return null;

  return (
    <View style={meterStyles.wrap}>
      <View style={[meterStyles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[meterStyles.fill, { backgroundColor: colour }, barStyle]} />
      </View>

      <View style={meterStyles.headRow}>
        <Text style={[meterStyles.label, { color: colour }]}>{check.label}</Text>
        {check.advice ? (
          <Text style={[meterStyles.advice, { color: subTextColor }]} numberOfLines={2}>
            {check.advice}
          </Text>
        ) : null}
      </View>

      <View style={meterStyles.rules}>
        {check.rules.map((r) => (
          <View key={r.key} style={meterStyles.ruleRow}>
            <Ionicons
              name={r.met ? "checkmark-circle" : "ellipse-outline"}
              size={14}
              color={r.met ? Colors.primary : subTextColor}
            />
            <Text
              style={[
                meterStyles.ruleText,
                { color: r.met ? subTextColor : subTextColor },
                r.met && { textDecorationLine: "line-through", opacity: 0.6 },
              ]}
            >
              {r.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const meterStyles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 8 },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  // `scaleX` from the left edge, so the bar grows rather than sliding.
  fill: { height: "100%", width: "100%", borderRadius: 2, transformOrigin: "left" },
  headRow: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  label: { fontFamily: "Poppins_600SemiBold", fontSize: 12.5 },
  advice: { fontFamily: "Poppins_400Regular", fontSize: 12, flex: 1 },
  rules: { gap: 5, marginTop: 2 },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  ruleText: { fontFamily: "Poppins_400Regular", fontSize: 12 },
});

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useSettingsStore();
  const params = useLocalSearchParams<{ add?: string; role?: string }>();

  const isDark = theme === "dark";
  const bg = isDark ? Colors.background : Colors.textWhite;
  const textColor = isDark ? Colors.textWhite : Colors.text;
  const subTextColor = isDark ? Colors.textSecondary : Colors.textTertiary;
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";

  const { selectedRole, setSelectedRole, setUser } = useAuthStore();

  /**
   * "Add another account" — a second account with a different role.
   *
   * Registration is reachable while already signed in, and finishing here must
   * not sign the first account out of the picker. `rememberAccount` keeps both,
   * which is what makes one phone able to hold a passenger and a driver login.
   */
  const addingAccount = params.add === "1";

  const [step, setStep] = useState<Step>("role");
  const [busy, setBusy] = useState(false);

  // ── Step 1: role ────────────────────────────────────────────────────────
  const [role, setRole] = useState<UserRole | null>(
    (params.role as UserRole) || (addingAccount ? null : selectedRole) || null,
  );

  // ── Step 2: you ─────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [age, setAge] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("NG");
  const [usernameState, setUsernameState] = useState<"idle" | "checking" | "free" | "taken" | "invalid">("idle");

  // ── Step 3: email ───────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [bypassEmailVerification, setBypassEmailVerification] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [emailError, setEmailError] = useState<string | null>(null);

  // ── Step 4: password ────────────────────────────────────────────────────
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const confirmRef = useRef<TextInput>(null);

  const pwContext = useMemo(
    () => ({ email, username, firstName, lastName }),
    [email, username, firstName, lastName],
  );
  const pwCheck = useMemo(() => checkPassword(password, pwContext), [password, pwContext]);

  /**
   * The confirm field only exists once the password is finished.
   */
  const showConfirmField = pwCheck.acceptable;

  useEffect(() => {
    if (!showConfirmField && confirm) setConfirm("");
  }, [showConfirmField, confirm]);

  const progress = (ORDER.indexOf(step) + 1) / ORDER.length;
  const barFill = useSharedValue(progress);
  useEffect(() => {
    barFill.value = withTiming(progress, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [progress, barFill]);
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.02, barFill.value) }],
  }));

  // Resend cooldown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  // ── Username availability, debounced ────────────────────────────────────
  useEffect(() => {
    const handle = username.trim().toLowerCase();
    if (!handle) { setUsernameState("idle"); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) { setUsernameState("invalid"); return; }

    setUsernameState("checking");
    let alive = true;
    const id = setTimeout(async () => {
      const free = await isUsernameAvailable(handle);
      if (alive) setUsernameState(free ? "free" : "taken");
    }, 400);
    return () => { alive = false; clearTimeout(id); };
  }, [username]);

  // ── Navigation between steps ────────────────────────────────────────────
  const goBack = useCallback(() => {
    Haptics.selectionAsync();
    const i = ORDER.indexOf(step);
    if (i === 0) { router.back(); return; }
    if (step === "password") { setPassword(""); setConfirm(""); }
    setStep(ORDER[i - 1]);
  }, [step, router]);

  const canLeaveYou =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    usernameState === "free" &&
    parseInt(age, 10) >= 18 &&
    (role !== "driver" || phone.trim().length >= 7);

  // ── Email verification ──────────────────────────────────────────────────
  const doSendCode = useCallback(async () => {
    if (busy || resendIn > 0) return;
    if (bypassEmailVerification) {
        setEmailVerified(true);
        setStep("password");
        return;
    }
    setBusy(true);
    setEmailError(null);
    try {
      const res = await sendCode(email);
      if (!res.ok) {
        setEmailError(res.message);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      setCodeSent(true);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setBusy(false);
    }
  }, [email, busy, resendIn, bypassEmailVerification]);

  const doVerifyCode = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setEmailError(null);
    try {
      const res = await verifyCode(email, code);
      if (!res.ok) {
        setEmailError(res.message);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      if (!res.isNew) {
        await abandon();
        setEmailError(null);
        iosAlert(
          "You already have an account",
          `${email.trim()} is already registered. Sign in instead — you can add a second account with a different email once you are in.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Sign in", onPress: () => router.replace("/(auth)/login") },
          ],
        );
        return;
      }
      setEmailVerified(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("password");
    } finally {
      setBusy(false);
    }
  }, [email, code, busy, router]);

  // ── Create the account ──────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (busy || !role) return;
    if (!pwCheck.acceptable) return;
    if (password !== confirm) {
      iosAlert("Passwords don't match", "Type the same password in both fields.");
      return;
    }

    setBusy(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const handle = username.trim().toLowerCase();

      if (!(await isUsernameAvailable(handle))) {
        setUsernameState("taken");
        setStep("you");
        iosAlert("Username taken", `"${handle}" was claimed while you were signing up. Pick another.`);
        return;
      }

      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const metadata: Record<string, unknown> = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: handle,
        full_name: fullName,
        age: parseInt(age, 10),
        role,
        country_code: country,
        currency_code: currencyForCountry(country),
        points_balance: 0,
        credits_balance: 0,
        device_fingerprint: await getDeviceFingerprint(),
        profile_complete: false,
        profile_photo: generateInitialsAvatar(fullName),
        ...(role === "driver"
          ? { phone: phone.trim(), driver_id: generateDriverIdFromUsername(handle) }
          : {}),
      };

      let userId = "";

      if (bypassEmailVerification) {
        // ── Bypass path: signUp then signIn to get a real session ──────
        const trimmedEmail = email.trim().toLowerCase();

        // 1. Try creating the user
        const { error: signUpErr } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: { data: metadata },
        });

        // "already registered" is fine — the email was used in a previous
        // OTP attempt that created an auth row. We just sign in instead.
        if (signUpErr) {
          const msg = signUpErr.message.toLowerCase();
          const isAlreadyRegistered =
            msg.includes("already registered") ||
            msg.includes("already been registered") ||
            msg.includes("user already registered");
          if (!isAlreadyRegistered) {
            console.error("[register] signUp error:", signUpErr.message);
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            iosAlert("Signup error", signUpErr.message);
            return;
          }
        }

        // 2. Establish a real session via password sign-in.
        //    signUp with email confirmation ON returns session: null, so we
        //    must sign in to get a working session for RLS / DB writes.
        const { data: signInData, error: signInErr } =
          await supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          });

        if (signInErr) {
          const errMsg = signInErr.message.toLowerCase();

          // Supabase blocks login when "Confirm email" is set to REQUIRED
          // rather than RECOMMENDED. Guide the developer to the fix.
          if (errMsg.includes("email not confirmed") || errMsg.includes("not confirmed")) {
            console.error(
              "[register] Email not confirmed. Go to Supabase Dashboard → " +
              "Authentication → Providers → Email → set 'Confirm email' " +
              "to OFF or RECOMMENDED (not REQUIRED) for bypass to work.",
            );
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            iosAlert(
              "Email confirmation required",
              "Your Supabase project requires email confirmation before sign-in. " +
              "To use the bypass:\n\n" +
              "1. Go to Supabase Dashboard → Authentication → Providers → Email\n" +
              "2. Set 'Confirm email' to OFF or change it from REQUIRED\n\n" +
              "Or disable the bypass toggle and use the normal OTP flow.",
            );
            return;
          }

          console.error("[register] signIn error:", signInErr.message);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          iosAlert("Sign-in error", signInErr.message);
          return;
        }
        if (!signInData.user) {
          iosAlert("Error", "Could not establish session after signup.");
          return;
        }

        userId = signInData.user.id;

        // 3. Ensure metadata is written (signUp may not have persisted it
        //    if the row already existed from a prior OTP attempt).
        await supabase.auth.updateUser({ data: metadata }).catch((e: any) =>
          console.warn("[register] metadata update:", e?.message),
        );
      } else {
        const res = await finishSignUp(password, metadata);
        if (!res.ok) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          iosAlert(t("common.error"), res.message);
          return;
        }
        userId = res.userId;
      }

      const { data: profile } = await supabase
        .from("users").select("*").eq("id", userId).maybeSingle();

      const user = (profile ?? { id: userId, email: email.trim(), ...metadata }) as any;
      setUser(user);
      setSelectedRole(role);
      await saveBiometricCredentials(email.trim(), password);
      await rememberAccount(user).catch(() => {});

      applyPendingReferral().catch(() => {});

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(auth)/provisioning");
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      iosAlert(t("common.error"), err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }, [
    busy, role, pwCheck.acceptable, password, confirm, username, firstName, lastName,
    age, phone, country, email, setUser, setSelectedRole, router, t, bypassEmailVerification,
  ]);

  const STEP_TITLES: Record<Step, { title: string; sub: string }> = {
    role:     { title: addingAccount ? "Add an account" : "Create your account",
                sub: addingAccount
                  ? "Your other account stays signed in — switch between them any time."
                  : "First, tell us how you'll use EMILGO." },
    you:      { title: "About you", sub: "This is what other people see." },
    email:    { title: "Your email", sub: "We'll send a code to make sure it's really yours." },
    password: { title: "Set a password", sub: "Type your own — no suggestions, no autofill." },
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={goBack} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={textColor} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: textColor }]}>{STEP_TITLES[step].title}</Text>
          <Text style={[styles.sub, { color: subTextColor }]}>{STEP_TITLES[step].sub}</Text>
        </View>
        <Text style={[styles.stepCount, { color: subTextColor }]}>
          {ORDER.indexOf(step) + 1}/{ORDER.length}
        </Text>
      </View>

      {/* Transform-only, so the progress bar does not force a layout pass on
          every step change. */}
      <View style={[styles.track, { backgroundColor: borderColor }]}>
        <Animated.View style={[styles.trackFill, barStyle]} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Role ─────────────────────────────────────────────────────── */}
        {step === "role" && (
          <Animated.View entering={FadeInDown.duration(260)} style={{ gap: 12 }}>
            {ROLES.map((r) => {
              const active = role === r.value;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setRole(r.value);
                  }}
                  style={[
                    styles.roleCard,
                    { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F5F7FA", borderColor },
                    active && { borderColor: Colors.primary, backgroundColor: Colors.primary },
                  ]}
                >
                  <View
                    style={[
                      styles.roleIcon,
                      { backgroundColor: active ? Colors.primary : borderColor },
                    ]}
                  >
                    <Ionicons name={r.icon} size={22} color={active ? "#fff" : subTextColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.roleLabel, { color: textColor }]}>{r.label}</Text>
                    <Text style={[styles.roleBlurb, { color: active ? textColor : subTextColor }]}>{r.blurb}</Text>
                  </View>
                  <Ionicons
                    name={active ? "checkmark-circle" : "ellipse-outline"}
                    size={25}
                    color={active ? Colors.textWhite : subTextColor}
                  />
                </Pressable>
              );
            })}

            {/* Park Owner is not offered. Saying so beats leaving an operator
                wondering whether the app supports them at all. */}
            <Text style={[styles.footnote, { color: subTextColor }]}>
              Running a park? Park accounts are set up with us directly — sign up
              as a driver or passenger for now and contact support.
            </Text>
          </Animated.View>
        )}

        {/* ── You ──────────────────────────────────────────────────────── */}
        {step === "you" && (
          <Animated.View entering={FadeInDown.duration(260)}>
            <View style={styles.nameRow}>
              <View style={{ flex: 1 }}>
                <FormField
                  label="First name"
                  icon="person-outline"
                  placeholder="Ada"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  autoComplete="given-name"
                  textContentType="givenName"
                  maxLength={40}
                />
              </View>
              <View style={{ flex: 1 }}>
                <FormField
                  label="Last name"
                  icon="person-outline"
                  placeholder="Obi"
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  autoComplete="family-name"
                  textContentType="familyName"
                  maxLength={40}
                />
              </View>
            </View>

            <FormField
              label="Username"
              icon="at-outline"
              placeholder="adaobi"
              value={username}
              onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
              maxLength={20}
              error={
                usernameState === "taken" ? "That username is taken."
                : usernameState === "invalid" ? "3–20 characters: letters, numbers and underscores."
                : null
              }
              hint={
                usernameState === "free" ? "Available."
                : "People find you by this. You can't change it later."
              }
              rightElement={
                usernameState === "checking" ? (
                  <ActivityIndicator size="small" color={subTextColor} />
                ) : usernameState === "free" ? (
                  <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                ) : usernameState === "taken" || usernameState === "invalid" ? (
                  <Ionicons name="close-circle" size={20} color={Colors.error} />
                ) : null
              }
            />

            <FormField
              label="Age"
              icon="calendar-outline"
              placeholder="18"
              value={age}
              onChangeText={(v) => setAge(v.replace(/\D/g, "").slice(0, 2))}
              keyboardType="number-pad"
              maxLength={2}
              error={age && parseInt(age, 10) < 18 ? "You must be 18 or older to use EMILGO." : null}
              hint="You have to be 18 to enter into a ride agreement."
            />

            {/* Drivers only.
                A passenger does not need to hand over a phone number to search
                for a trip, and collecting one before there is a reason is data
                you then have to protect — see COMPLIANCE.md §2.7. Passengers
                add a number later, with consent, when a driver needs to call.
                A driver has to be reachable to be dispatched at all. */}
            {role === "driver" && (
              <FormField
                label="Phone"
                icon="call-outline"
                placeholder="080 1234 5678"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                maxLength={20}
                hint="Passengers see this only after you accept their trip."
              />
            )}

            <Text style={[fieldStyles.label, { color: textColor }]}>Country</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.countryRow}>
              {COUNTRIES.map((c) => {
                const on = country === c.code;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => { Haptics.selectionAsync(); setCountry(c.code); }}
                    style={[
                      styles.countryChip,
                      { backgroundColor: on ? Colors.primary : borderColor },
                    ]}
                  >
                    <Text style={[styles.countryText, { color: on ? "#fff" : textColor }]}>
                      {c.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={[fieldStyles.hintText, { color: subTextColor }]}>
              Sets the currency fares are shown in.
            </Text>
          </Animated.View>
        )}

        {/* ── Email ────────────────────────────────────────────────────── */}
        {step === "email" && (
          <Animated.View entering={FadeInDown.duration(260)}>
            <FormField
              label="Email"
              icon="mail-outline"
              placeholder="you@example.com"
              value={email}
              onChangeText={(v) => { setEmail(v.trim()); setEmailError(null); }}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              error={emailError}
              hint={codeSent ? `Code sent to ${email}` : "We'll send a code here before your account is created."}
              rightElement={
                emailVerified ? (
                  <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                ) : null
              }
            />

            {__DEV__ && (
              <Pressable
                onPress={() => setBypassEmailVerification(!bypassEmailVerification)}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingHorizontal: 4 }}
              >
                <Ionicons
                  name={bypassEmailVerification ? "checkbox-outline" : "square-outline"}
                  size={20}
                  color={bypassEmailVerification ? Colors.primary : subTextColor}
                />
                <Text style={{ fontFamily: "Poppins_400Regular", fontSize: 13, color: subTextColor }}>
                  [DEV] Bypass Email Verification
                </Text>
              </Pressable>
            )}

            {codeSent && !bypassEmailVerification && (
              <Animated.View entering={FadeInDown.duration(240)}>
                <FormField
                  label={`${CODE_LENGTH}-digit code`}
                  icon="keypad-outline"
                  placeholder="123456"
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, CODE_LENGTH))}
                  keyboardType="number-pad"
                  maxLength={CODE_LENGTH}
                  // The ONE place a one-time code SHOULD be autofilled: iOS can
                  // read it out of the mail notification.
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                />

                <Pressable
                  onPress={doSendCode}
                  disabled={resendIn > 0 || busy}
                  style={styles.resend}
                >
                  <Text style={[styles.resendText, { color: resendIn > 0 ? subTextColor : Colors.primary }]}>
                    {resendIn > 0 ? `Resend in ${resendIn}s` : "Send a new code"}
                  </Text>
                </Pressable>
              </Animated.View>
            )}
          </Animated.View>
        )}

        {/* ── Password ─────────────────────────────────────────────────── */}
        {step === "password" && (
          <Animated.View entering={FadeInDown.duration(260)}>
            <FormField
              label="Password"
              icon="lock-closed-outline"
              placeholder="Type your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              noAutofill
              maxLength={72}
              rightElement={
                <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={10}>
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={subTextColor}
                  />
                </Pressable>
              }
            />

            <PasswordMeter password={password} context={pwContext} />

            {/* Revealed only once the password passes every rule — see the note
                on `showConfirmField`. */}
            {showConfirmField && (
              <Animated.View entering={FadeInDown.duration(260)}>
                <FormField
                  label="Confirm password"
                  icon="lock-closed-outline"
                  placeholder="Type it again"
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry={!showConfirm}
                  noAutofill
                  inputRef={confirmRef}
                  maxLength={72}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  error={confirm && confirm !== password ? "Passwords don't match." : null}
                  hint={confirm && confirm === password ? null : null}
                  rightElement={
                    <Pressable onPress={() => setShowConfirm((s) => !s)} hitSlop={10}>
                      <Ionicons
                        name={showConfirm ? "eye-off-outline" : "eye-outline"}
                        size={20}
                        color={subTextColor}
                      />
                    </Pressable>
                  }
                />
              </Animated.View>
            )}

            <Text style={[styles.footnote, { color: subTextColor }]}>
              Your password has to be one you chose and can remember.
            </Text>
          </Animated.View>
        )}
      </ScrollView>

      {/* ── The one action ─────────────────────────────────────────────── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12, borderTopColor: borderColor }]}>
        {step === "role" && (
          <PrimaryButton
            label="Continue"
            disabled={!role}
            onPress={() => { setSelectedRole(role!); setStep("you"); }}
          />
        )}

        {step === "you" && (
          <PrimaryButton
            label="Continue"
            disabled={!canLeaveYou}
            onPress={() => setStep("email")}
          />
        )}

        {step === "email" && (
          <PrimaryButton
            label={
              bypassEmailVerification
                ? "Continue (skip verification)"
                : busy ? "Please wait…" : codeSent ? "Verify code" : "Send code"
            }
            busy={busy}
            disabled={
              busy ||
              (bypassEmailVerification
                ? email.trim().length < 5 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
                : codeSent ? code.length !== CODE_LENGTH : email.trim().length < 5)
            }
            onPress={
              bypassEmailVerification
                ? doSendCode   // doSendCode already short-circuits with bypass
                : codeSent ? doVerifyCode : doSendCode
            }
          />
        )}



        {step === "password" && (
          <PrimaryButton
            label={busy ? "Creating your account…" : "Create account"}
            busy={busy}
            disabled={busy || !pwCheck.acceptable || confirm !== password || !confirm}
            onPress={submit}
            // onPress={() => router.replace("/(auth)/provisioning")}
          />
        )}

        {step === "role" && !addingAccount ? (
          <Pressable onPress={() => router.replace("/(auth)/login")} style={styles.signInRow}>
            <Text style={[styles.signInText, { color: subTextColor }]}>
              Already have an account? <Text style={{ color: Colors.primary }}>Sign in</Text>
            </Text>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function PrimaryButton({
  label, onPress, disabled, busy,
}: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable
      onPress={() => { if (!disabled) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); } }}
      disabled={disabled}
      style={[styles.primary, disabled && styles.primaryDisabled]}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 20, paddingBottom: 14 },
  back: { width: 34, height: 34, alignItems: "center", justifyContent: "center", marginTop: 2 },
  headerText: { flex: 1 },
  title: { fontFamily: "Poppins_700Bold", fontSize: 22 },
  sub: { fontFamily: "Poppins_400Regular", fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  stepCount: { fontFamily: "Poppins_500Medium", fontSize: 13, marginTop: 6 },

  track: { height: 3, marginHorizontal: 20, borderRadius: 2, overflow: "hidden" },
  trackFill: {
    height: "100%", width: "100%", borderRadius: 2,
    backgroundColor: Colors.primary, transformOrigin: "left",
  },

  body: { paddingHorizontal: 20, paddingTop: 58 },

  roleCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 36, padding: 16, borderWidth: .5,
  },
  roleIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel: { fontFamily: "Poppins_600SemiBold", fontSize: 16 },
  roleBlurb: { fontFamily: "Poppins_400Regular", fontSize: 12.5, lineHeight: 18, marginTop: 2 },

  nameRow: { flexDirection: "row", gap: 12 },

  countryRow: { gap: 8, paddingVertical: 2, paddingRight: 20 },
  countryChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  countryText: { fontFamily: "Poppins_500Medium", fontSize: 13 },

  resend: { alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 5 },
  resendText: { fontFamily: "Poppins_500Medium", fontSize: 13.5 },

  footnote: { fontFamily: "Poppins_400Regular", fontSize: 12, lineHeight: 18, marginTop: 18, paddingHorizontal: 4 },

  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  primary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: Colors.primary, borderRadius: 26, height: 52,
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { fontFamily: "Poppins_600SemiBold", fontSize: 16, color: "#fff" },

  signInRow: { alignItems: "center", paddingVertical: 8 },
  signInText: { fontFamily: "Poppins_400Regular", fontSize: 13.5 },
});
