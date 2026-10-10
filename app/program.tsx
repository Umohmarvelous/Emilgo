/**
 * app/program.tsx
 *
 * Program Page (Loyalty Program). Top-level route (rendered by the root Stack in
 * app/_layout.tsx) so it opens as a full screen over the tab shell.
 *
 * MULTI-STEP KYC WIZARD (OPay/bank-KYC style): one screen per step with a progress
 * bar up top; finishing a step unlocks the next. Steps:
 *   1. Get started — how credits are earned (the ONLY place amounts are shown) +
 *      eligibility progress. Gated: you must have enough credits to continue.
 *   2. Verify identity — NIN/BVN + number.
 *   3. Face capture — selfie/liveness (front camera), like a bank KYC.
 *   4. Verify phone — phone + OTP (dev code 123456).
 *   5. Payout bank — bank + account number → Verify & Apply.
 * On success the same screen shows the "you're in" status card.
 *
 * All verification is mock-backed for now; wiring real Smile Identity keys later
 * won't change this screen (only src/services/kyc.ts).
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Image,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Colors } from "@/constants/colors";
import { Glass, IOSButton, IOSSegmentedTabs, useIOSTheme } from "@/components/ios";
import { useAuthStore } from "@/src/store/useStore";
import { useCreditsStore } from "@/src/store/useCreditsStore";
import { useProgramStore, ProgramForm } from "@/src/store/useProgramStore";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { EARN_RULES, MIN_CREDITS_TO_APPLY } from "@/constants/credits";
import { DEV_OTP_CODE } from "@/src/services/kyc";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { ArrowLeft01Icon, Tick04Icon } from "@hugeicons/core-free-icons";


// A small set of Nigerian banks for the payout picker (code = Paystack bank code).
const BANKS = [
  { name: "Access Bank", code: "044" },
  { name: "GTBank", code: "058" },
  { name: "Zenith Bank", code: "057" },
  { name: "UBA", code: "033" },
  { name: "First Bank", code: "011" },
  { name: "OPay", code: "999992" },
];

// The interactive wizard steps, in order.
const STEPS = [
  { key: "intro", title: "Get started" },
  { key: "identity", title: "Verify identity" },
  { key: "selfie", title: "Face capture" },
  { key: "phone", title: "Verify phone" },
  { key: "payout", title: "Payout bank" },
] as const;
const LAST_STEP = STEPS.length - 1;

// ⚠️ DEV ONLY — set to `true` to click through every wizard step without valid
// inputs or enough credits (for testing the UI). MUST be `false` in production;
// the final "Verify & Apply" still runs the real (mock) KYC checks either way.
const DEV_BYPASS_STEP_GATES = false;

export default function ProgramScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useSettingsStore();
  const isDark = theme === "dark";

  const user = useAuthStore((s) => s.user);
  const credits = useCreditsStore((s) => s.balance);
  const { programStatus, submitting, submitApplication, sendOtp, hydrateFromUser } =
    useProgramStore();

  // Wizard position
  const [step, setStep] = useState(0);

  // Form state
  const [idType, setIdType] = useState<"nin" | "bvn">("nin");
  const [idNumber, setIdNumber] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [bankCode, setBankCode] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    hydrateFromUser(user);
  }, [user, hydrateFromUser]);

  const enrolled = programStatus === "eligible" || programStatus === "enrolled";
  const meetsCredits = credits >= MIN_CREDITS_TO_APPLY;
  const progress = Math.min(1, credits / MIN_CREDITS_TO_APPLY);

  const textColor = isDark ? Colors.textWhite : Colors.text;
  // const subTextColor = isDark ? Colors.textTertiary : Colors.textSecondary;
  const cardBg = isDark ? Colors.overlayLight : Colors.border;
  const bg = isDark ? Colors.background : Colors.textWhite;

  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "#E8ECF0";
  
  // Whether the current step is complete enough to advance.
  const canAdvance = useMemo(() => {
    if (DEV_BYPASS_STEP_GATES) return !submitting;
    switch (STEPS[step].key) {
      case "intro":
        return meetsCredits;
      case "identity":
        return idNumber.trim().length === 11;
      case "selfie":
        return !!selfie;
      case "phone":
        return otpSent && otp.trim().length > 0;
      case "payout":
        return !!bankCode && accountNumber.trim().length === 10 && !submitting;
      default:
        return false;
    }
  }, [step, meetsCredits, idNumber, selfie, otpSent, otp, bankCode, accountNumber, submitting]);

  const goBack = () => {
    setErrorMsg(null);
    if (step === 0) {
      router.back();
    } else {
      setStep((s) => s - 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const goNext = () => {
    if (!canAdvance) return;
    setErrorMsg(null);
    if (step === LAST_STEP) {
      handleSubmit();
    } else {
      setStep((s) => s + 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const captureSelfie = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setErrorMsg("Camera access is needed for the face check.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: false,
      quality: 0.6,
    });
    if (!res.canceled && res.assets?.[0]) {
      setSelfie(res.assets[0].uri);
      setErrorMsg(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleSendOtp = async () => {
    if (phone.trim().length < 7) {
      setErrorMsg("Enter a valid phone number first.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await sendOtp(phone);
    setOtpSent(true);
    setErrorMsg(null);
  };

  const handleSubmit = async () => {
    if (!user?.id) return;
    setErrorMsg(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const form: ProgramForm = {
      idType,
      idNumber: idNumber.trim(),
      selfie: selfie ?? undefined,
      phone: phone.trim(),
      otp: otp.trim(),
      bankCode,
      accountNumber: accountNumber.trim(),
    };
    const res = await submitApplication(user, form);
    if (res.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setErrorMsg(res.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // ── Already enrolled → status screen (no wizard) ──────────────────────────
  if (enrolled) {
    return (
      <View style={[styles.root, { backgroundColor: bg }]}>
        <Header title="Loyalty Program" textColor={textColor} onBack={() => router.back()} insetTop={insets.top} />
        <View style={styles.doneWrap}>
          <View style={styles.doneBadge}>
            <Ionicons name="shield-checkmark" size={44} color={Colors.primary} />
          </View>
          <Text style={[styles.doneTitle, { color: textColor }]}>You&apos;re in the program</Text>
          <Text style={styles.doneSub}>
            Verified — you can now earn free-fuel & free-ride rewards. Payouts go only
            to your verified bank account.
          </Text>
          <IOSButton
            title="Done"
            size="large"
            fullWidth
            style={{ marginTop: 20 }}
            onPress={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const stepMeta = STEPS[step];

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <Header title="Loyalty Program" textColor={textColor} onBack={goBack} insetTop={insets.top} />

      {/* Progress */}
      <View style={styles.progressWrap}>
        <View style={styles.stepBarRow}>
          {STEPS.map((s, i) => (
            <View
              key={s.key}
              style={[
                styles.stepSegment,
                { backgroundColor: i <= step ? Colors.primary : "rgba(128,128,128,0.25)" },
              ]}
            />
          ))}
        </View>
        <Text style={styles.stepCount}>
          Step {step + 1} of {STEPS.length} · {stepMeta.title}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Step 1: intro + how you earn + eligibility ── */}
          {stepMeta.key === "intro" && (
            <>
              <View style={{marginVertical: 20}}>
                <View style={[styles.card, { borderWidth: 1, flexDirection: 'column' }, { backgroundColor: cardBg, borderColor }]}>

                  <View style={styles.progressHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7}}>
                      <Text style={[styles.sectionTitle, { color: textColor }]}>Your eligibility  •</Text>
                      <Text style={[styles.earnAmount, { color: meetsCredits ? Colors.primary : Colors.gold }]}>
                        {meetsCredits ?
                          (
                            <View style={[{ flexDirection: 'row', borderRadius: 10, padding: 5, borderWidth: 1, borderColor: isDark ? "rgba(255,255,255,0.08)"  : Colors.text, gap: 4 }, {backgroundColor: isDark ? Colors.primaryDark : Colors.overlayLight, borderColor}]}>
                              <Text style={{color: meetsCredits ? Colors.primary : Colors.gold}}>Eligible</Text>
                              < HugeiconsIcon icon={Tick04Icon} color={Colors.primary} fill={Colors.primary} size={14} />
                            </View>
                          ) : "Not Eligible"}
                      </Text>
                    </View>
                    
                    <Text style={[styles.earnLabel, { color: textColor }]}>
                      {credits} / {MIN_CREDITS_TO_APPLY}
                    </Text>
                  </View>

                  {!meetsCredits && (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                    </View>
                  )}
                </View>
                  {!meetsCredits && (
                    <Text style={styles.lockNote}>
                      Reach {MIN_CREDITS_TO_APPLY} credits to start your application.
                    </Text>
                  )}
              </View>



              <View style={{marginTop: 0}}>
                <Text style={[styles.stepHeading, { color: textColor }, {fontSize: 19}]}>How you earn credits</Text>
                <Text style={styles.stepLede}>
                  Earn credits by engaging in the app, then complete a quick verification
                  to unlock free-fuel & free-ride rewards.
                </Text>
              </View>




              {/* <Text style={[styles.sectionTitle, { color: textColor }]}>How you earn credits</Text> */}
              <View style={[styles.card, {borderWidth: 1}, { backgroundColor: cardBg, borderColor }]}>
                {EARN_RULES.map((rule, i) => (
                  <View
                    key={rule.key}
                    style={[styles.earnRow, i < EARN_RULES.length - 1 && styles.earnRowBorder]}
                  >
                    <Text style={[styles.earnLabel, { color: textColor }]}>{rule.label}</Text>
                    <Text style={styles.earnAmount}>🪙 {rule.amount}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* ── Step 2: identity ── */}
          {stepMeta.key === "identity" && (
            <>
              <Text style={[styles.stepHeading, { color: textColor }, {fontSize: 19, marginTop: 50, marginBottom: 0, marginLeft: 5}]}>Verify your identity</Text>
              <Text style={[styles.stepLede, {marginLeft: 5}]}>
                Enter a valid government ID.
                Do not show your <Text>{idType}</Text> number to anyone.
              </Text>
              <View style={[styles.card, { padding: 0, borderWidth: 1, borderColor: borderColor },
                { backgroundColor: cardBg }
              ]}>
                {/* One control, not two pills: the pair shares a single set of
                    rounded top corners and its inner edge stays square. */}
                <IOSSegmentedTabs
                  segments={[
                    { key: "nin", label: "NIN" },
                    { key: "bvn", label: "BVN" },
                  ]}
                  active={idType}
                  onChange={setIdType}
                  radius={30}
                  rounded="top"
                  height={64}
                />
    
                <View style={{margin: 19}}>
                  <FieldInput
                    label={`${idType.toUpperCase()} number`}
                    value={idNumber}
                    onChangeText={setIdNumber}
                    placeholder="11-digit number"
                    keyboardType="number-pad"
                    maxLength={11}
                    textColor={textColor}
                    isDark={isDark}
                  />
                </View>
              </View>
              {/* <Text style={[styles.stepLede, {marginLeft: 7}]}>We store only a secure hash — never the
                raw number. Do not show your <Text>{idType}</Text> number to anyone.
              </Text> */}
            </>
          )}



          {/* ── Step 3: face capture ── */}
          {stepMeta.key === "selfie" && (
            <>
              <Text style={[styles.stepHeading, { color: textColor }]}>Face capture</Text>
              {/* <View style={{flexDirection: 'row'}}> */}
                <Text style={styles.stepLede}>
                Take a quick selfie so we can match your face to your ID.... <Text style={[styles.stepLede, {color: Colors.textWhite, fontWeight: "bold", fontFamily: "Poppins_600SemiBold"}]}>Tips: </Text> Look straight at the camera in good light.
                </Text> 
              {/* </View> */}
              
              <View style={[styles.card, { backgroundColor: cardBg, alignItems: "center", gap: 16 }, { borderWidth: 1, borderColor: borderColor, paddingVertical: 40 }]}>
                <View style={{borderWidth: 2, borderColor: Colors.primary, padding: 4, borderRadius: 100, borderStyle: 'solid'}}>
                  <View style={[styles.selfieRing]}>
                    {selfie ? (
                      <Image source={{ uri: selfie }} style={styles.selfieImg} />
                    ) : (
                      <Ionicons name="person-outline" size={64} color={Colors.textSecondary} />
                    )}
                  </View>
                </View>
                <Pressable style={[styles.secondaryBtn, {borderColor: borderColor}]} onPress={captureSelfie}>
                  <Glass
                    variant="clear"
                    interactive
                    radius={12}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                    fallbackIntensity={25}
                    fallbackTint="transparent"
                  />
                  <Ionicons name="camera-outline" size={18} color={Colors.textWhite} />
                  <Text style={styles.secondaryBtnText}>
                    {selfie ? "Retake photo" : "Take photo"}
                  </Text>
                </Pressable>
                {selfie && <Text style={styles.hint}>Looks good ✓ Tap Continue.</Text>}
              </View>
            </>
          )}

          {/* ── Step 4: phone + OTP ── */}
          {stepMeta.key === "phone" && (
            <>
              <Text style={[styles.stepHeading, { color: textColor }]}>Verify your phone</Text>
              <Text style={styles.stepLede}>
                We&apos;ll send a code to confirm this number is yours.
              </Text>
              <View style={[styles.card, { backgroundColor: cardBg }, {borderWidth: 1, borderColor: borderColor, gap: 5 }]}>
                <FieldInput
                  label="Phone number"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Enter phone No."
                  keyboardType="phone-pad"
                  textColor={textColor}
                  isDark={isDark}
                />
                {!otpSent ? (
                  <Pressable style={styles.secondaryBtn} onPress={handleSendOtp}>
                    <Text style={[styles.secondaryBtnText, {color: Colors.primary}]}>Send code</Text>
                  </Pressable>
                ) : (
                  <>
                    <FieldInput
                      label="Verification code"
                      value={otp}
                      onChangeText={setOtp}
                      placeholder={`Enter code`}
                      keyboardType="number-pad"
                      maxLength={6}
                      textColor={textColor}
                      isDark={isDark}
                    />
                    <Text style={styles.hint}>Code sent to {phone}.</Text>
                      <Pressable onPress={handleSendOtp} hitSlop={8} style={{marginVertical: 10, marginLeft: 5}}>
                      <Text style={styles.resendText}>Resend code</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </>
          )}

          {/* ── Step 5: payout bank ── */}
          {stepMeta.key === "payout" && (
            <>
              <Text style={[styles.stepHeading, { color: textColor }]}>Payout account</Text>
              <Text style={styles.stepLede}>
                Rewards are paid only to a bank account in your own verified name.
              </Text>
              <View style={[styles.card, { backgroundColor: cardBg }, {borderWidth: 1, borderColor: borderColor, paddingVertical: 20 }]}>
                <Text style={[styles.fieldLabel, { color: textColor }]}>Bank</Text>
                <View style={styles.bankRow}>
                  {BANKS.map((b) => (
                    <Pressable
                      key={b.code}
                      onPress={() => setBankCode(b.code)}
                      style={styles.bankChip}
                      accessibilityRole="button"
                      accessibilityState={{ selected: bankCode === b.code }}
                    >
                      <Glass
                        variant={bankCode === b.code ? "regular" : "clear"}
                        tint={bankCode === b.code ? Colors.primary : undefined}
                        interactive
                        radius={20}
                        style={StyleSheet.absoluteFill}
                        pointerEvents="none"
                        fallbackIntensity={30}
                        fallbackTint={bankCode === b.code ? Colors.primary : "rgba(128,128,128,0.12)"}
                      />
                      <Text style={[styles.bankChipText, bankCode === b.code && styles.bankChipTextActive]}>
                        {b.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <FieldInput
                  label="Account number"
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  placeholder="10-digit NUBAN"
                  keyboardType="number-pad"
                  maxLength={10}
                  textColor={textColor}
                  isDark={isDark}
                />
                <Text style={styles.privacyNote}>
                  We verify the account name matches your ID before enrolling you.
                </Text>
              </View>
            </>
          )}

          {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}
        </ScrollView>

        {/* Sticky footer nav */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <IOSButton
            title={step === LAST_STEP ? "Verify & Apply" : "Continue"}
            size="large"
            fullWidth
            loading={submitting}
            disabled={!canAdvance}
            onPress={goNext}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({
  title,
  textColor,
  onBack,
  insetTop,
}: {
  title: string;
  textColor: string;
  onBack: () => void;
  insetTop: number;
  }) {
  const iosTheme = useIOSTheme()

  return (
    <View style={[styles.header, { paddingTop: insetTop + 12 }]}>
      <Pressable
        style={styles.backBtn}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Glass
          variant="clear"
          interactive
          radius={20}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          fallbackIntensity={0}
          fallbackTint="transparent"
        />
        <HugeiconsIcon icon={ArrowLeft01Icon} size={24} color={iosTheme.label} strokeWidth={2} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: textColor }]}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

// ─── Reusable labelled input ──────────────────────────────────────────────────
function FieldInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  maxLength,
  textColor,
  isDark,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: "default" | "number-pad" | "phone-pad";
  maxLength?: number;
  textColor: string;
  isDark: boolean;
}) {
  return (
    <View style={{ gap: 6, marginBottom: 12 }}>
      <Text style={[styles.fieldLabel, { color: textColor }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          {
            color: textColor,
            backgroundColor: isDark ? "rgba(255,255,255,0.05)" : Colors.border,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)"}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 17 },

  // Progress
  progressWrap: { paddingHorizontal: 18, paddingBottom: 8, gap: 8 },
  stepBarRow: { flexDirection: "row", gap: 6 },
  stepSegment: { flex: 1, height: 6, borderRadius: 3 },
  stepCount: { fontFamily: "Poppins_500Medium", fontSize: 12, color: Colors.textSecondary },

  content: { paddingHorizontal: 18, gap: 14, paddingTop: 6 },
  stepHeading: { fontFamily: "Poppins_600SemiBold", fontSize: 20, marginTop: 50, marginBottom: 0, marginLeft: 5 },
  stepLede: { fontFamily: "Poppins_400Regular", fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 4, marginLeft: 7 },

  card: { borderRadius: 30, padding: 16, gap: 4,  },
  sectionTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 14, marginVertical: 4, marginLeft: 7 },
  earnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 20, paddingHorizontal: 15
  },
  earnRowBorder: { borderBottomWidth: 1, borderBottomColor: "rgba(128,128,128,0.15)" },
  earnLabel: { fontFamily: "Poppins_500Medium", fontSize: 14 },
  earnAmount: { fontFamily: "Poppins_600SemiBold", fontSize: 14, color: Colors.gold },
  progressHeader: {  alignItems: 'center', flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(128,128,128,0.2)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: Colors.primary },
  lockNote: {
    fontFamily: "Poppins_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 12, marginLeft: 5
  },

  // Selfie
  selfieRing: {
    width: 160,
    height: 160,
    borderRadius: 80,
    // borderWidth: 2,
    // borderColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(128,128,128,0.08)",
  },
  selfieImg: { width: "100%", height: "100%" },

  toggleRow: {
    flexDirection: "row", borderBottomWidth: .5,
    // borderWidth: 2, borderColor: 'red',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    overflow: "hidden",
    alignItems: "center",
    // borderTopLeftRadius: 50,
    // borderTopRightRadius: 50,
    // borderWidth: 2, borderColor: 'blue'
  },
  toggleText: { fontFamily: "Poppins_600SemiBold", fontSize: 13, color: Colors.textSecondary },
  toggleTextActive: { color: "#fff" },
  fieldLabel: { fontFamily: "Poppins_500Medium", fontSize: 12, marginLeft: 4 },
  input: {
    height: 50,
    borderRadius: 30,
    paddingHorizontal: 14,
    fontFamily: "Poppins_400Regular",
    fontSize: 14,
  },
  secondaryBtn: {
    flexDirection: "row",
    gap: 8,
    height: 46,
    paddingHorizontal: 20,
    // borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
    // borderWidth: 1,
    overflow: "hidden",
  },
  secondaryBtnText: { fontFamily: "Poppins_600SemiBold", fontSize: 14, color: Colors.textWhite },
  hint: { fontFamily: "Poppins_400Regular", fontSize: 11, color: Colors.textSecondary, marginLeft: 4 },
  resendText: { fontFamily: "Poppins_600SemiBold", fontSize: 14, color: Colors.primary, marginLeft: 0, marginTop: 15 },
  bankRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 34, marginTop: 6 },
  bankChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: "hidden",
  },
  bankChipText: { fontFamily: "Poppins_500Medium", fontSize: 12, color: Colors.textSecondary },
  bankChipTextActive: { color: "#fff" },
  errorText: {
    fontFamily: "Poppins_500Medium",
    fontSize: 12,
    color: "#EF4444",
    marginTop: 2,
    marginLeft: 4,
  },

  // Footer
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.2)",
  },
  privacyNote: {
    fontFamily: "Poppins_400Regular",
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 6,
    marginLeft: 4,
  },

  // Done screen
  doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 14 },
  doneBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    // backgroundColor: "rgba(0,154,67,0.12)",
  },
  doneTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 20 },
  doneSub: {
    fontFamily: "Poppins_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
});
