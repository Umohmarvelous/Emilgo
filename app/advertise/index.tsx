// app/advertise/index.tsx
//
// The advertiser portal: billboards in EMILGO Games (games/emilgo-games/SPEC-V3.md
// §8). A business signs in with an ordinary EMILGO account, makes an advertiser
// account, uploads a picture, a slideshow or a short film, says where it may
// show, pays for a budget, and waits for a person to approve it.
//
// ── What decides things ────────────────────────────────────────────────────
// Nothing here. The database refuses a submission that breaks a rule, keeps it
// off the air until it's reviewed, and only the app's server (with the provider's
// word) can turn a checkout into budget. This screen is the form in front of
// that (src/services/billboards.ts).
//
// Billboards show in the EMILGO app and on the web, never in Lagos Life, and
// count views without knowing who saw them.

import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Platform,
  Image,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";

import { Glass, useIOSTheme, IOSAppFont, iosAlert, IOSSegmentedTabs } from "@/components/ios";
import { useAuthStore } from "@/src/store/useStore";
import {
  BILLBOARD_RULES,
  MAP_NAMES,
  listSlots,
  myAccount,
  myBillboards,
  startCheckout,
  listBoards,
  bookBoard,
  type NumberedBoard,
  submitBillboard,
  uploadAdMedia,
  verifyPayment,
  type AdAccount,
  type AdPrices,
  type BoardFormat,
  type BoardSlot,
  type MyBillboard,
  type PayProvider,
} from "@/src/services/billboards";

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

type Where = "all" | "naija-world" | "spooky-world";

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "url" | "email-address";
  hint?: string;
}) {
  const t = useIOSTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: t.secondaryLabel }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: t.tertiarySystemFill, color: t.label }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.tertiaryLabel}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === "url" || keyboardType === "email-address" ? "none" : "sentences"}
      />
      {hint ? <Text style={[styles.fieldHint, { color: t.tertiaryLabel }]}>{hint}</Text> : null}
    </View>
  );
}

function Row({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useIOSTheme();
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: t.label }]}>{label}</Text>
        {sub ? <Text style={[styles.fieldHint, { color: t.tertiaryLabel }]}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function StatusPill({ status }: { status: MyBillboard["review_status"] }) {
  const t = useIOSTheme();
  const color = status === "approved" ? t.systemGreen : status === "rejected" ? t.systemRed : t.systemOrange;
  const text = status === "approved" ? "Approved" : status === "rejected" ? "Not approved" : "Waiting for review";
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

export default function AdvertiseScreen() {
  const t = useIOSTheme();
  const insets = useSafeAreaInsets();
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  const params = useLocalSearchParams<{ ref?: string; session_id?: string; cancelled?: string }>();

  const [loading, setLoading] = React.useState(true);
  const [account, setAccount] = React.useState<AdAccount | null>(null);
  const [prices, setPrices] = React.useState<AdPrices | null>(null);
  const [slots, setSlots] = React.useState<BoardSlot[]>([]);
  const [mine, setMine] = React.useState<MyBillboard[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);

  // The account form.
  const [bizName, setBizName] = React.useState("");
  const [bizEmail, setBizEmail] = React.useState("");
  // Paying.
  const [amount, setAmount] = React.useState("");
  // v6: Flutterwave first on the web (the web game's billing), Paystack in the app.
  const [provider, setProvider] = React.useState<PayProvider>(Platform.OS === "web" ? "flutterwave" : "paystack");
  // v6: booking one numbered board for 1 or 2 weeks.
  const [boards, setBoards] = React.useState<NumberedBoard[]>([]);
  const [board, setBoard] = React.useState<string | null>(null);
  const [weeks, setWeeks] = React.useState<"1" | "2">("1");
  const [bookAd, setBookAd] = React.useState<string | null>(null);
  // The billboard.
  const [headline, setHeadline] = React.useState("");
  const [website, setWebsite] = React.useState("https://");
  const [format, setFormat] = React.useState<BoardFormat>("static");
  const [pictures, setPictures] = React.useState<string[]>([]);
  const [film, setFilm] = React.useState<string | null>(null);
  const [poster, setPoster] = React.useState<string | null>(null);
  const [where, setWhere] = React.useState<Where>("all");
  const [premium, setPremium] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [cycle, setCycle] = React.useState<"10" | "30" | "0">("30");
  const [audio, setAudio] = React.useState(false);
  const [days, setDays] = React.useState("");
  const [attest, setAttest] = React.useState<string[]>([]);

  const load = React.useCallback(async () => {
    try {
      const [a, s, m] = await Promise.all([myAccount(), listSlots(), myBillboards()]);
      listBoards().then(setBoards).catch(() => setBoards([]));
      setAccount(a.account);
      setPrices(a.prices);
      setSlots(s);
      setMine(m);
    } catch (e: any) {
      iosAlert("Couldn't load", e?.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (signedIn) load();
    else setLoading(false);
  }, [signedIn, load]);

  // Back from a provider's checkout: ask the server whether it went through.
  React.useEffect(() => {
    if (!signedIn || !params.ref || params.cancelled) return;
    verifyPayment(params.ref, params.session_id ?? null)
      .then((r) => {
        iosAlert(r.ok ? "Payment received" : "Not paid yet", r.ok ? "Your budget has been added." : "If you paid, it can take a minute. Pull to check again.");
        load();
      })
      .catch((e) => iosAlert("Couldn't check the payment", e?.message ?? "Please try again."));
  }, [signedIn, params.ref, params.session_id, params.cancelled, load]);

  const createAccount = async () => {
    setBusy("account");
    try {
      const a = await myAccount(bizName.trim(), bizEmail.trim());
      setAccount(a.account);
      setPrices(a.prices);
    } catch (e: any) {
      iosAlert("Couldn't create the account", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const pay = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return iosAlert("How much?", "Enter the budget in naira.");
    setBusy("pay");
    try {
      const c = await startCheckout(provider, n, mine[0]?.id ?? null);
      if (c.checkout_url) {
        if (Platform.OS === "web") window.location.href = c.checkout_url;
        else {
          await WebBrowser.openBrowserAsync(c.checkout_url);
          const r = await verifyPayment(c.reference);
          iosAlert(r.ok ? "Payment received" : "Not paid yet", r.ok ? "Your budget has been added." : "If you paid, it can take a minute.");
          load();
        }
      } else {
        iosAlert(
          "Test mode",
          c.settled ? "No money moved: the server has no payment key yet, and test budgets are on. Budget added." : "No money moved: the server has no key for this provider yet.",
        );
        load();
      }
    } catch (e: any) {
      iosAlert("Couldn't start the payment", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  /** v6: book the picked board for 1 or 2 weeks with the picked ad. */
  const book = async () => {
    const b = boards.find((x) => x.id === board);
    const ad = bookAd ?? mine[0]?.id ?? null;
    if (!b) return iosAlert("Which billboard?", "Pick a numbered billboard from the list.");
    if (!ad) return iosAlert("Which ad?", "Make a billboard ad first (below): it's what goes on the board.");
    setBusy("book");
    try {
      const c = await bookBoard(provider, b.id, weeks === "2" ? 2 : 1, ad);
      if (c.checkout_url) {
        if (Platform.OS === "web") window.location.href = c.checkout_url;
        else {
          await WebBrowser.openBrowserAsync(c.checkout_url);
          const r = await verifyPayment(c.reference);
          iosAlert(r.ok ? "Billboard booked" : "Not paid yet", r.ok ? `Billboard ${b.number} is yours for ${weeks === "2" ? "2 weeks" : "1 week"} once your ad is approved.` : "If you paid, it can take a minute.");
          load();
        }
      } else {
        iosAlert("Test mode", c.settled ? `No money moved (test mode). Billboard ${b.number} is booked.` : "No money moved: the server has no key for this provider yet.");
        load();
      }
    } catch (e: any) {
      iosAlert("Couldn't book it", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  /** Pick and upload: pictures (one, or 2–6 for a slideshow), a film, or its still. */
  const pick = async (what: "picture" | "film" | "poster") => {
    const many = what === "picture" && format === "slideshow";
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: what === "film" ? ["videos"] : ["images"],
      allowsMultipleSelection: many,
      selectionLimit: many ? 6 : 1,
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.length) return;
    setBusy(what);
    try {
      const urls: string[] = [];
      for (const a of res.assets) urls.push(await uploadAdMedia(a.uri, what === "film" ? "video" : "image", a.mimeType ?? null));
      if (what === "film") setFilm(urls[0]);
      else if (what === "poster") setPoster(urls[0]);
      else setPictures(many ? urls.slice(0, 6) : urls.slice(0, 1));
    } catch (e: any) {
      iosAlert("Couldn't upload", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy("submit");
    try {
      const d = Number(days);
      await submitBillboard({
        headline: headline.trim(),
        website: website.trim(),
        format,
        mediaUrl: format === "static" ? (pictures[0] ?? null) : format === "video" ? film : null,
        slides: format === "slideshow" ? pictures : [],
        posterUrl: format === "video" ? poster : null,
        maps: where === "all" ? [] : [where],
        slots: premium ? picked : [],
        premium,
        cycle: Number(cycle) as 0 | 10 | 30,
        audio: format === "video" && audio,
        endsAt: Number.isFinite(d) && d > 0 ? new Date(Date.now() + d * 86400_000).toISOString() : null,
        attest,
      });
      iosAlert("Sent for review", "A person checks every billboard before it goes up. You'll see the answer here.");
      setHeadline("");
      setPictures([]);
      setFilm(null);
      setPoster(null);
      setPicked([]);
      setAttest([]);
      load();
    } catch (e: any) {
      iosAlert("Couldn't send it", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const topInset = insets.top + 54;
  const premiumSlots = slots.filter((s) => s.premium && (where === "all" || s.map === where));
  const card = [styles.card, { backgroundColor: t.secondarySystemGroupedBackground }];

  let body: React.ReactNode;
  if (loading) {
    body = <ActivityIndicator color={t.tint} style={{ marginTop: 40 }} />;
  } else if (!signedIn) {
    body = (
      <View style={card}>
        <Text style={[styles.cardTitle, { color: t.label }]}>Sign in to advertise</Text>
        <Text style={[styles.body, { color: t.secondaryLabel }]}>Use your EMILGO account. Your advertiser account is made from it.</Text>
        <Pressable onPress={() => router.push("/(auth)/login")} style={[styles.primaryBtn, { backgroundColor: t.tint }]}>
          <Text style={styles.primaryBtnText}>Sign in</Text>
        </Pressable>
      </View>
    );
  } else if (!account) {
    body = (
      <View style={card}>
        <Text style={[styles.cardTitle, { color: t.label }]}>Your advertiser account</Text>
        <Field label="Business name" value={bizName} onChangeText={setBizName} placeholder="As it should appear to our reviewers" />
        <Field label="Contact email" value={bizEmail} onChangeText={setBizEmail} keyboardType="email-address" />
        <Pressable disabled={busy === "account" || !bizName.trim()} onPress={createAccount} style={[styles.primaryBtn, { backgroundColor: t.tint, opacity: bizName.trim() ? 1 : 0.5 }]}>
          {busy === "account" ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create account</Text>}
        </Pressable>
      </View>
    );
  } else {
    const left = Math.max(0, account.budget - account.spent);
    const pending = format === "video" ? !film || !poster : format === "slideshow" ? pictures.length < 2 : pictures.length !== 1;
    const ready = headline.trim() && /^https:\/\/\S{3,}/.test(website.trim()) && !pending && attest.length === BILLBOARD_RULES.length && (!premium || picked.length > 0);
    body = (
      <>
        <View style={card}>
          <Text style={[styles.cardTitle, { color: t.label }]}>{account.name}</Text>
          <View style={styles.statRow}>
            <Stat label="Budget" value={naira(account.budget)} />
            <Stat label="Spent" value={naira(account.spent)} />
            <Stat label="Left" value={naira(left)} />
          </View>
          {prices ? (
            <Text style={[styles.fieldHint, { color: t.tertiaryLabel, marginTop: 6 }]}>
              {naira(prices.rotation_cpm)} per 1,000 views in the rotation, {naira(prices.premium_cpm)} on a premium board. Smallest budget {naira(prices.min_budget)}.
              {prices.placeholder ? " These are test prices: real prices are set before billboards go on sale." : ""}
            </Text>
          ) : null}
        </View>

        <View style={card}>
          <Text style={[styles.cardTitle, { color: t.label }]}>Add budget</Text>
          <Field label="Amount (₦)" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder={prices ? String(prices.min_budget) : ""} />
          <View style={{ marginTop: 10 }}>
            <IOSSegmentedTabs<PayProvider>
              segments={[
                { key: "paystack", label: "Paystack" },
                { key: "flutterwave", label: "Flutterwave" },
                { key: "stripe", label: "Stripe" },
              ]}
              active={provider}
              onChange={setProvider}
              variant="capsule"
            />
          </View>
          <Pressable disabled={busy === "pay"} onPress={pay} style={[styles.primaryBtn, { backgroundColor: t.tint }]}>
            {busy === "pay" ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Pay</Text>}
          </Pressable>
        </View>

        <View style={card}>
          <Text style={[styles.cardTitle, { color: t.label }]}>Book a billboard</Text>
          <Text style={[styles.fieldHint, { color: t.tertiaryLabel }]}>
            One board, yours alone, for 1 or 2 weeks. Each is numbered with the place it stands in the game's world.
            {boards.some((b) => b.placeholder) ? " Test prices: real prices are set before billboards go on sale." : ""}
          </Text>
          <View style={{ maxHeight: 280, marginTop: 8 }}>
            <ScrollView nestedScrollEnabled>
              {boards.map((b) => {
                const on = board === b.id;
                const free = new Date(b.free_from).getTime() <= Date.now() + 60_000;
                return (
                  <Pressable key={b.id} onPress={() => setBoard(b.id)} style={[styles.boardRow, { borderColor: on ? t.tint : "transparent", backgroundColor: on ? "rgba(0,154,67,0.08)" : "transparent" }]}>
                    <Text style={[styles.boardNum, { color: t.tint }]}>{b.number ?? "–"}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.label, fontFamily: "Poppins_500Medium", fontSize: 13 }} numberOfLines={2}>{b.label}</Text>
                      <Text style={{ color: t.tertiaryLabel, fontSize: 11 }}>
                        1 week {naira(b.week1)} · 2 weeks {naira(b.week2)} · {free ? "free now" : `free from ${new Date(b.free_from).toLocaleDateString()}`}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {!boards.length ? <Text style={[styles.fieldHint, { color: t.tertiaryLabel }]}>The numbered list appears once the v6 billboard migration has been run.</Text> : null}
            </ScrollView>
          </View>
          <View style={{ marginTop: 10 }}>
            <IOSSegmentedTabs<"1" | "2">
              segments={[
                { key: "1", label: "1 week" },
                { key: "2", label: "2 weeks" },
              ]}
              active={weeks}
              onChange={setWeeks}
              variant="capsule"
            />
          </View>
          {mine.length > 1 ? (
            <View style={{ marginTop: 10 }}>
              <Text style={[styles.groupTitle, { color: t.secondaryLabel }]}>WHICH AD</Text>
              {mine.map((m) => (
                <Pressable key={m.id} onPress={() => setBookAd(m.id)} style={[styles.boardRow, { borderColor: (bookAd ?? mine[0].id) === m.id ? t.tint : "transparent" }]}>
                  <Text style={{ color: t.label, fontSize: 13 }}>{m.headline}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Pressable disabled={busy === "book" || !board} onPress={book} style={[styles.primaryBtn, { backgroundColor: t.tint, opacity: board ? 1 : 0.5 }]}>
            {busy === "book" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {(() => {
                  const b = boards.find((x) => x.id === board);
                  return b ? `Book billboard ${b.number} · ${naira(weeks === "2" ? b.week2 : b.week1)}` : "Pick a billboard";
                })()}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={card}>
          <Text style={[styles.cardTitle, { color: t.label }]}>New billboard</Text>
          <Field label="Name of the ad" value={headline} onChangeText={setHeadline} placeholder="For you and our reviewers" />
          <Field label="Your website" value={website} onChangeText={setWebsite} keyboardType="url" hint="Reviewers check it. Players can't tap a billboard." />

          <Text style={[styles.groupTitle, { color: t.secondaryLabel }]}>WHAT IT SHOWS</Text>
          <IOSSegmentedTabs<BoardFormat>
            segments={[
              { key: "static", label: "Picture" },
              { key: "slideshow", label: "Slideshow" },
              { key: "video", label: "Film" },
            ]}
            active={format}
            onChange={(f) => {
              setFormat(f);
              setPictures([]);
            }}
            variant="capsule"
          />
          <Text style={[styles.fieldHint, { color: t.tertiaryLabel, marginTop: 6 }]}>
            Boards are 2:1 (wide). Pictures: JPEG, PNG or WebP under 2 MB. Films: MP4 under 20 MB, with a still for phones that don&apos;t play films.
          </Text>
          {format !== "video" ? (
            <MediaButton label={format === "slideshow" ? `Pick 2–6 pictures (${pictures.length})` : pictures.length ? "Change picture" : "Pick a picture"} busy={busy === "picture"} onPress={() => pick("picture")} />
          ) : (
            <>
              <MediaButton label={film ? "Change film" : "Pick a film"} busy={busy === "film"} onPress={() => pick("film")} />
              <MediaButton label={poster ? "Change the still" : "Pick the still"} busy={busy === "poster"} onPress={() => pick("poster")} />
            </>
          )}
          <View style={styles.thumbs}>
            {[...(format === "video" ? (poster ? [poster] : []) : pictures)].map((u) => (
              <Image key={u} source={{ uri: u }} style={styles.thumb} />
            ))}
          </View>

          <Text style={[styles.groupTitle, { color: t.secondaryLabel }]}>WHERE</Text>
          <IOSSegmentedTabs<Where>
            segments={[
              { key: "all", label: "Every map" },
              { key: "naija-world", label: "Naija World" },
              { key: "spooky-world", label: "Spooky World" },
            ]}
            active={where}
            onChange={(w) => {
              setWhere(w);
              setPicked([]);
            }}
            variant="capsule"
          />
          <Row label="A premium board" sub="Yours alone for every match, outside the rotation. Pick the boards below." value={premium} onChange={(v) => { setPremium(v); setPicked([]); }} />
          {premium
            ? premiumSlots.map((s) => (
                <Row
                  key={s.id}
                  label={s.label || s.id}
                  sub={`${MAP_NAMES[s.map] ?? s.map} · ${s.id}`}
                  value={picked.includes(s.id)}
                  onChange={(v) => setPicked((p) => (v ? [...p, s.id] : p.filter((x) => x !== s.id)))}
                />
              ))
            : null}

          <Text style={[styles.groupTitle, { color: t.secondaryLabel }]}>HOW LONG ON A BOARD</Text>
          <IOSSegmentedTabs<"10" | "30" | "0">
            segments={[
              { key: "10", label: "10 s" },
              { key: "30", label: "30 s" },
              { key: "0", label: "Whole match" },
            ]}
            active={cycle}
            onChange={setCycle}
            variant="capsule"
          />
          {format === "video" ? <Row label="Film sound" sub="Only for players who turn Ads audio on. Off by default for everyone." value={audio} onChange={setAudio} /> : null}
          <Field label="Run for (days)" value={days} onChangeText={setDays} keyboardType="numeric" hint="Empty: until the budget runs out." />

          <Text style={[styles.groupTitle, { color: t.secondaryLabel }]}>CONTENT RULES</Text>
          {BILLBOARD_RULES.map((r) => (
            <Row key={r.id} label={r.label} value={attest.includes(r.id)} onChange={(v) => setAttest((a) => (v ? [...a, r.id] : a.filter((x) => x !== r.id)))} />
          ))}

          <Pressable disabled={!ready || busy === "submit"} onPress={submit} style={[styles.primaryBtn, { backgroundColor: t.tint, opacity: ready ? 1 : 0.5 }]}>
            {busy === "submit" ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send for review</Text>}
          </Pressable>
        </View>

        {mine.map((b) => (
          <View key={b.id} style={card}>
            <View style={styles.rowHead}>
              <Text style={[styles.rowTitle, { color: t.label }]} numberOfLines={1}>
                {b.headline}
              </Text>
              <StatusPill status={b.review_status} />
            </View>
            <Text style={[styles.rowSub, { color: t.tertiaryLabel }]}>
              {[b.board_format, b.maps.length ? b.maps.map((m) => MAP_NAMES[m] ?? m).join(", ") : "Every map", b.static_premium ? `premium: ${b.slot_ids.join(", ")}` : "rotation"].join(" · ")}
            </Text>
            {b.review_notes ? <Text style={[styles.body, { color: t.secondaryLabel }]}>{b.review_notes}</Text> : null}
            <View style={styles.statRow}>
              <Stat label="Views" value={b.views.toLocaleString("en-NG")} />
              <Stat label="Seconds seen" value={Math.round(b.seconds).toLocaleString("en-NG")} />
            </View>
          </View>
        ))}
      </>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.systemGroupedBackground }]}>
      <Stack.Screen options={{ headerShown: false, title: "Advertise" }} />
      <ScrollView contentContainerStyle={{ paddingTop: topInset + 12, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={[styles.title, { color: t.label }]}>Billboards in EMILGO Games</Text>
          <Text style={[styles.body, { color: t.secondaryLabel }]}>
            Your picture, slideshow or short film on the billboards of the game&apos;s cities: Naija World in Free For All and Spooky World in Dead Streets, in the EMILGO app and on the web.
            Never in Lagos Life. We count views per board, never who saw them.
          </Text>
        </View>
        {body}
      </ScrollView>
      <View style={[styles.bar, { paddingTop: insets.top, height: topInset }]}>
        <Glass variant="regular" style={StyleSheet.absoluteFill} pointerEvents="none" fallbackIntensity={60} fallbackTint={t.systemBackground} />
        <View style={styles.barRow}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={12} accessibilityLabel="Back">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={24} color={t.label} strokeWidth={2} />
          </Pressable>
          <Text style={[styles.barTitle, { color: t.label }]}>Advertise</Text>
        </View>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useIOSTheme();
  return (
    <View style={{ gap: 1 }}>
      <Text style={[styles.statValue, { color: t.label }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: t.tertiaryLabel }]}>{label}</Text>
    </View>
  );
}

function MediaButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  const t = useIOSTheme();
  return (
    <Pressable onPress={onPress} disabled={busy} style={[styles.mediaBtn, { backgroundColor: t.tertiarySystemFill }]}>
      {busy ? <ActivityIndicator color={t.tint} /> : <Text style={[styles.link, { color: t.tint }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20, overflow: "hidden" },
  barRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  barTitle: { ...IOSAppFont.headline },
  intro: { paddingHorizontal: 20, paddingBottom: 14, gap: 6 },
  title: { ...IOSAppFont.title2, fontFamily: "Poppins_700Bold" },
  body: { ...IOSAppFont.subheadline, lineHeight: 20 },
  card: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14, gap: 6, maxWidth: 720, alignSelf: "stretch" },
  cardTitle: { ...IOSAppFont.headline, marginBottom: 4 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { ...IOSAppFont.body, fontFamily: "Poppins_600SemiBold", flex: 1 },
  rowSub: { ...IOSAppFont.caption1 },
  rowLabel: { ...IOSAppFont.subheadline },
  link: { ...IOSAppFont.subheadline, fontFamily: "Poppins_600SemiBold" },
  field: { gap: 5, marginTop: 8 },
  fieldLabel: { ...IOSAppFont.caption1, fontFamily: "Poppins_500Medium" },
  fieldHint: { ...IOSAppFont.caption2, lineHeight: 15 },
  input: { height: 42, borderRadius: 10, paddingHorizontal: 12, fontFamily: "Poppins_400Regular", fontSize: 14 },
  groupTitle: { ...IOSAppFont.caption2, letterSpacing: 0.5, marginTop: 16, marginBottom: 4 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  statRow: { flexDirection: "row", gap: 18, marginTop: 6, flexWrap: "wrap" },
  statValue: { ...IOSAppFont.subheadline, fontFamily: "Poppins_700Bold" },
  statLabel: { ...IOSAppFont.caption2, textTransform: "uppercase", letterSpacing: 0.4 },
  primaryBtn: { height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 14 },
  primaryBtnText: { ...IOSAppFont.body, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  // v6: the numbered billboards.
  boardRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1.5, marginBottom: 4 },
  boardNum: { width: 34, textAlign: "center", fontFamily: "Poppins_700Bold", fontSize: 18 },
  mediaBtn: { height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 8 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  thumb: { width: 120, height: 60, borderRadius: 6 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { ...IOSAppFont.caption2, fontFamily: "Poppins_600SemiBold" },
});
