// app/nearby.tsx
//
// Phase 7 — proximity, as one screen with three panes:
//
//   People   — drivers/passengers near you, from our own presence table
//   Instant  — Fastest Finger: discounted seats leaving now, first come first served
//   Fuel     — nearest filling stations, from OpenStreetMap
//
// ── Why one screen and not three ─────────────────────────────────────────────
// All three answer the same question — "what is around me right now" — from the
// same fix, and a user who doesn't find a driver often wants the fuel list next.
// Three entries in a menu would make them feel unrelated and would take three
// GPS acquisitions instead of one.
//
// ── The location fix ─────────────────────────────────────────────────────────
// Acquired ONCE at the top and passed down. Each pane loading its own would
// triple the battery cost and produce three slightly different origins, so the
// same station could show a different distance depending on which tab you were
// on.
//
// ── Offline ──────────────────────────────────────────────────────────────────
// Every read returns `stale` when it fell back to cache, and the panes say so.
// An empty list and a failed request look identical to a user, and only one of
// them is worth pulling to refresh.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Linking,
  ScrollView,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
import { SymbolView } from "expo-symbols";

import {
  Glass,
  IOSScreen,
  IOSSegmentedTabs,
  IOSSheet,
  IOSButton,
  iosAlert,
  useCollapsibleScroll,
  useIOSTheme,
  IOSAppFont,
  type IOSSegment,
} from "@/components/ios";
import Avatar from "@/components/Avatar";
import { Colors } from "@/constants/colors";
import { haptics } from "@/src/utils/haptics";
import { formatNaira } from "@/src/utils/helpers";
import { useAuthStore } from "@/src/store/useStore";
import {
  findNearby,
  findFastestFinger,
  findFillingStations,
  claimFastestFinger,
  createFastestFinger,
  expireFastestFinger,
  publishPresence,
  type NearbyUser,
  type FastestFingerOffer,
  type FillingStation,
} from "@/src/services/proximity";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { Plus } from "@hugeicons/core-free-icons";

type Pane = "people" | "instant" | "fuel";

const PANES: IOSSegment<Pane>[] = [
  { key: "people", label: "People" },
  { key: "instant", label: "Instant" },
  { key: "fuel", label: "Fuel" },
];

const RADIUS_KM = 5;

interface Fix {
  lat: number;
  lng: number;
}

export default function NearbyScreen() {
  const ios = useIOSTheme();
  const scroll = useCollapsibleScroll();
  const user = useAuthStore((s) => s.user);

  const [pane, setPane] = useState<Pane>("people");
  const [fix, setFix] = useState<Fix | null>(null);
  const [permission, setPermission] = useState<"granted" | "denied" | "pending">("pending");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [people, setPeople] = useState<NearbyUser[]>([]);
  const [offers, setOffers] = useState<FastestFingerOffer[]>([]);
  const [stations, setStations] = useState<FillingStation[]>([]);
  const [stale, setStale] = useState(false);
  const [composing, setComposing] = useState(false);

  // A passenger looks for drivers and vice versa. Park owners see everyone,
  // because their job is knowing who is at the park.
  const lookingFor = useMemo<"driver" | "passenger" | null>(() => {
    if (user?.role === "driver") return "passenger";
    if (user?.role === "passenger") return "driver";
    return null;
  }, [user?.role]);

  // ── Fix ────────────────────────────────────────────────────────────────────

  const acquireFix = useCallback(async (): Promise<Fix | null> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setPermission("denied");
      return null;
    }
    setPermission("granted");

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const next = { lat: position.coords.latitude, lng: position.coords.longitude };
    setFix(next);

    // Being here is opting in to being found: publish so the search is mutual.
    // Without this the first users see an empty map and assume it's broken.
    void publishPresence({
      lat: next.lat,
      lng: next.lng,
      accuracy: position.coords.accuracy ?? null,
    });

    return next;
  }, []);

  const load = useCallback(
    async (at: Fix) => {
      // Sweep expired offers first so the Instant pane is honest about what is
      // still claimable.
      void expireFastestFinger();

      const [nearbyResult, offersResult, stationsResult] = await Promise.all([
        findNearby({ lat: at.lat, lng: at.lng, radiusKm: RADIUS_KM, role: lookingFor }),
        findFastestFinger({ lat: at.lat, lng: at.lng, radiusKm: RADIUS_KM }),
        findFillingStations({ lat: at.lat, lng: at.lng, radiusKm: RADIUS_KM }),
      ]);

      setPeople(nearbyResult.data);
      setOffers(offersResult.data);
      setStations(stationsResult.data);
      setStale(nearbyResult.stale || offersResult.stale || stationsResult.stale);
    },
    [lookingFor],
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const at = await acquireFix();
        if (at) await load(at);
      } finally {
        setLoading(false);
      }
    })();
  }, [acquireFix, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const at = fix ?? (await acquireFix());
      if (at) await load(at);
    } finally {
      setRefreshing(false);
    }
  }, [fix, acquireFix, load]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const claim = useCallback(
    async (offer: FastestFingerOffer) => {
      haptics.tap();
      const result = await claimFastestFinger(offer.id);

      if (!result.ok) {
        // The expected loss, not an error: someone else was faster. Say so
        // plainly rather than showing a raw failure.
        iosAlert(
          result.reason === "unavailable" ? "Seat taken" : "Couldn't claim",
          result.reason === "unavailable"
            ? "Someone claimed the last seat first. Pull to refresh for more offers."
            : result.reason,
        );
        void onRefresh();
        return;
      }

      haptics.success();
      iosAlert(
        result.alreadyClaimed ? "Already yours" : "Seat claimed",
        result.alreadyClaimed
          ? "You already have a seat on this ride."
          : `Meet ${offer.driver_name ?? "your driver"} for ${formatNaira(offer.discounted_fare)}.`,
        [
          { text: "OK", style: "cancel" },
          {
            text: "Message driver",
            onPress: () => router.push(`/direct-chat/${offer.driver_id}` as never),
          },
        ],
      );
      void onRefresh();
    },
    [onRefresh],
  );

  const openInMaps = useCallback((station: FillingStation) => {
    haptics.tap();
    // A geo:/maps: URL hands off to whatever the user actually has installed,
    // so this needs no maps SDK and no API key.
    const label = encodeURIComponent(station.name);
    const url = `https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}&query_place_id=${label}`;
    Linking.openURL(url).catch(() =>
      iosAlert("Can't open maps", "No maps app is available on this device."),
    );
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (permission === "denied") {
    return (
      <IOSScreen title="Nearby" back>
        <View style={styles.empty}>
          <SymbolView name="location.slash" size={54} tintColor={ios.tertiaryLabel} fallback={null} />
          <Text style={[IOSAppFont.label, { color: ios.label }]}>Location is off</Text>
          <Text style={[IOSAppFont.description, styles.centre, { color: ios.secondaryLabel }]}>
            Emilgo needs your location to show who and what is around you. Nothing is
            published until you turn it on.
          </Text>
          <IOSButton title="Open Settings" variant="filled" onPress={() => Linking.openSettings()} />
        </View>
      </IOSScreen>
    );
  }

  return (
    <IOSScreen
      title="Find Nearby"
      subtitle={`Within ${RADIUS_KM} km`}
      back
      scrollable={false}
      scroll={scroll}
      right={
        user?.role === "driver" ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              setComposing(true);
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Post an instant ride"
          >
            <HugeiconsIcon
              icon={Plus}
              size={24}
              color={ios.label}
            />
          </Pressable>
        ) : undefined
      }
    >
      <ScrollView
        style={{paddingHorizontal: 10}}
        showsVerticalScrollIndicator={false}
        {...scroll.scrollProps}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            progressViewOffset={scroll.contentInset}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.strip}>
          <IOSSegmentedTabs
            segments={PANES}
            active={pane}
            onChange={setPane}
            variant="capsule"
            rounded="all"
          />
        </View>

        {stale && (
          <View style={styles.staleRow}>
            <SymbolView name="wifi.slash" size={13} tintColor={ios.systemOrange} fallback={null} />
            <Text style={[IOSAppFont.description, { color: ios.systemOrange }]}>
              Showing last known results
            </Text>
          </View>
        )}

        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={ios.label} size={'large'} />
            <Text style={[IOSAppFont.description, { color: ios.secondaryLabel }]}>
              {`Looking for nearby users…`}
            </Text>
          </View>
        ) : pane === "people" ? (
          <PeoplePane people={people} lookingFor={lookingFor} />
        ) : pane === "instant" ? (
          <InstantPane offers={offers} onClaim={claim} isDriver={user?.role === "driver"} />
        ) : (
          <FuelPane stations={stations} onOpen={openInMaps} />
        )}
      </ScrollView>

      <ComposeOffer
        visible={composing}
        fix={fix}
        onClose={() => setComposing(false)}
        onPosted={() => {
          setComposing(false);
          setPane("instant");
          void onRefresh();
        }}
      />
    </IOSScreen>
  );
}

// ─── Post an instant ride (drivers) ──────────────────────────────────────────
//
// Short and pre-filled by design. The whole proposition is "I am leaving NOW",
// so a long form defeats it — a driver filling in six fields at the roadside has
// already left.

function ComposeOffer({
  visible,
  fix,
  onClose,
  onPosted,
}: {
  visible: boolean;
  fix: Fix | null;
  onClose: () => void;
  onPosted: () => void;
}) {
  const ios = useIOSTheme();
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [baseFare, setBaseFare] = useState("");
  const [discount, setDiscount] = useState(20);
  const [seats, setSeats] = useState(1);
  const [minutes, setMinutes] = useState(15);
  const [posting, setPosting] = useState(false);

  const base = Number(baseFare) || 0;
  const discounted = Math.max(1, Math.round(base * (1 - discount / 100)));
  const valid = origin.trim() && destination.trim() && base > 0 && !!fix;

  const post = useCallback(async () => {
    if (!valid || !fix) return;
    setPosting(true);
    try {
      const result = await createFastestFinger({
        origin: origin.trim(),
        destination: destination.trim(),
        baseFare: base,
        discountedFare: discounted,
        seats,
        lat: fix.lat,
        lng: fix.lng,
        minutes,
      });

      if (!result.ok) {
        iosAlert("Couldn't post", result.error ?? "Please try again.");
        return;
      }
      haptics.success();
      onPosted();
    } finally {
      setPosting(false);
    }
  }, [valid, fix, origin, destination, base, discounted, seats, minutes, onPosted]);

  return (
    <IOSSheet visible={visible} onClose={onClose} title="Instant ride" detent="large">
      <View style={composeStyles.body}>
        <Text style={[IOSAppFont.description, { color: ios.secondaryLabel }]}>
          Nearby passengers see this immediately and the first to claim get the seats.
          It disappears on its own.
        </Text>

        <Field label="From" value={origin} onChangeText={setOrigin} placeholder="Oshodi" />
        <Field label="To" value={destination} onChangeText={setDestination} placeholder="Ikeja" />
        <Field
          label="Normal fare (₦)"
          value={baseFare}
          onChangeText={setBaseFare}
          placeholder="1500"
          keyboardType="number-pad"
        />

        <Stepper label="Discount" value={`${discount}%`} onDown={() => setDiscount((d) => Math.max(5, d - 5))} onUp={() => setDiscount((d) => Math.min(60, d + 5))} />
        <Stepper label="Seats" value={String(seats)} onDown={() => setSeats((s) => Math.max(1, s - 1))} onUp={() => setSeats((s) => Math.min(8, s + 1))} />
        <Stepper label="Expires in" value={`${minutes} min`} onDown={() => setMinutes((m) => Math.max(5, m - 5))} onUp={() => setMinutes((m) => Math.min(60, m + 5))} />

        {base > 0 && (
          <View style={composeStyles.preview}>
            <Text style={[IOSAppFont.description, { color: ios.secondaryLabel }]}>
              Passengers pay
            </Text>
            <Text style={[composeStyles.previewFare, { color: Colors.primary }]}>
              {formatNaira(discounted)}
            </Text>
            <Text style={[IOSAppFont.description, { color: ios.tertiaryLabel }]}>
              instead of {formatNaira(base)}
            </Text>
          </View>
        )}

        {!fix && (
          <Text style={[IOSAppFont.description, { color: ios.systemRed }]}>
            Waiting for your location — an offer needs a position so passengers can
            see how far away you are.
          </Text>
        )}

        <IOSButton
          title={posting ? "Posting…" : "Post instant ride"}
          variant="filled"
          disabled={!valid || posting}
          onPress={post}
        />
      </View>
    </IOSSheet>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  const ios = useIOSTheme();
  return (
    <View style={composeStyles.field}>
      <Text style={[IOSAppFont.sectionTitle, { color: ios.secondaryLabel }]}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        placeholderTextColor={ios.tertiaryLabel}
        style={[
          composeStyles.input,
          { color: ios.label, backgroundColor: ios.tertiarySystemFill },
        ]}
        {...props}
      />
    </View>
  );
}

function Stepper({
  label,
  value,
  onDown,
  onUp,
}: {
  label: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
  const ios = useIOSTheme();
  return (
    <View style={composeStyles.stepper}>
      <Text style={[IOSAppFont.label, { color: ios.label }]}>{label}</Text>
      <View style={composeStyles.stepperControls}>
        <Pressable onPress={() => { haptics.tap(); onDown(); }} hitSlop={8} style={composeStyles.stepBtn}>
          <SymbolView name="minus" size={15} tintColor={ios.tint} fallback={null} />
        </Pressable>
        <Text style={[IOSAppFont.label, composeStyles.stepValue, { color: ios.label }]}>
          {value}
        </Text>
        <Pressable onPress={() => { haptics.tap(); onUp(); }} hitSlop={8} style={composeStyles.stepBtn}>
          <SymbolView name="plus" size={15} tintColor={ios.tint} fallback={null} />
        </Pressable>
      </View>
    </View>
  );
}

const composeStyles = StyleSheet.create({
  body: { padding: 20, gap: 16 },
  field: { gap: 6 },
  input: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Poppins_500Medium",
    fontSize: 15,
  },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepBtn: { padding: 6 },
  stepValue: { minWidth: 62, textAlign: "center" },
  preview: { alignItems: "center", gap: 2, paddingVertical: 6 },
  previewFare: { fontFamily: "Poppins_700Bold", fontSize: 26 },
});

// ─── People ──────────────────────────────────────────────────────────────────

function PeoplePane({
  people,
  lookingFor,
}: {
  people: NearbyUser[];
  lookingFor: "driver" | "passenger" | null;
}) {
  const ios = useIOSTheme();

  if (people.length === 0) {
    return (
      <EmptyPane
        symbol="person.2.slash"
        title={`No ${lookingFor ?? "one"} nearby`}
        body="Nobody with location sharing on is within range right now."
      />
    );
  }

  return (
    <View style={styles.list}>
      {people.map((person) => (
        <Pressable
          key={person.user_id}
          onPress={() => {
            haptics.tap();
            router.push(`/direct-chat/${person.user_id}` as never);
          }}
          style={styles.card}
        >
          <Glass
            variant="regular"
            radius={CARD_RADIUS}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            fallbackIntensity={40}
            fallbackTint={ios.scheme === "dark" ? "rgba(255,255,255,0.06)" : "#FFFFFF"}
          />
          <Avatar name={person.full_name || "User"} photoUri={person.profile_photo ?? undefined} size={44} />

          <View style={styles.cardText}>
            <Text numberOfLines={1} style={[IOSAppFont.label, { color: ios.label }]}>
              {person.full_name || "Emilgo user"}
            </Text>
            <Text numberOfLines={1} style={[IOSAppFont.description, { color: ios.secondaryLabel }]}>
              {person.vehicle_details || person.role}
              {person.avg_rating ? ` · ★ ${Number(person.avg_rating).toFixed(1)}` : ""}
            </Text>
          </View>

          <Distance km={person.distance_km} />
        </Pressable>
      ))}
    </View>
  );
}

// ─── Instant (Fastest Finger) ────────────────────────────────────────────────

function InstantPane({
  offers,
  onClaim,
  isDriver,
}: {
  offers: FastestFingerOffer[];
  onClaim: (o: FastestFingerOffer) => void;
  isDriver: boolean;
}) {
  const ios = useIOSTheme();

  if (offers.length === 0) {
    return (
      <EmptyPane
        symbol="bolt.slash"
        title="No instant rides"
        body={
          isDriver
            ? "Post a discounted seat when you're about to leave and nearby passengers can take it immediately."
            : "Drivers post discounted seats here when they're leaving right away. Check back shortly."
        }
      />
    );
  }

  return (
    <View style={styles.list}>
      {offers.map((offer) => {
        const saving = offer.base_fare - offer.discounted_fare;
        const percent = Math.round((saving / offer.base_fare) * 100);

        return (
          <View key={offer.id} style={styles.offerCard}>
            <Glass
              variant="regular"
              radius={CARD_RADIUS}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              fallbackIntensity={40}
              fallbackTint={ios.scheme === "dark" ? "rgba(255,255,255,0.06)" : "#FFFFFF"}
            />

            <View style={styles.offerHead}>
              <Avatar
                name={offer.driver_name || "Driver"}
                photoUri={offer.driver_photo ?? undefined}
                size={38}
              />
              <View style={styles.cardText}>
                <Text numberOfLines={1} style={[IOSAppFont.label, { color: ios.label }]}>
                  {offer.driver_name || "Driver"}
                </Text>
                <Text numberOfLines={1} style={[IOSAppFont.description, { color: ios.secondaryLabel }]}>
                  {offer.vehicle_details || "Vehicle"}
                  {offer.driver_rating ? ` · ★ ${Number(offer.driver_rating).toFixed(1)}` : ""}
                </Text>
              </View>
              <Distance km={offer.distance_km} />
            </View>

            <View style={styles.route}>
              <Text numberOfLines={1} style={[IOSAppFont.label, { color: ios.label }]}>
                {offer.origin} → {offer.destination}
              </Text>
            </View>

            <View style={styles.fareRow}>
              <Text style={[styles.fareNow, { color: Colors.primary }]}>
                {formatNaira(offer.discounted_fare)}
              </Text>
              {saving > 0 && (
                <>
                  <Text style={[styles.fareWas, { color: ios.tertiaryLabel }]}>
                    {formatNaira(offer.base_fare)}
                  </Text>
                  <View style={styles.savePill}>
                    <Text style={styles.saveText}>−{percent}%</Text>
                  </View>
                </>
              )}
              <Text style={[IOSAppFont.description, styles.seats, { color: ios.secondaryLabel }]}>
                {offer.seats_left} seat{offer.seats_left === 1 ? "" : "s"} left
              </Text>
            </View>

            <IOSButton
              title={offer.claimed_by_me ? "Claimed" : "Claim seat"}
              variant={offer.claimed_by_me ? "tinted" : "filled"}
              disabled={offer.claimed_by_me}
              onPress={() => onClaim(offer)}
            />
          </View>
        );
      })}
    </View>
  );
}

// ─── Fuel ────────────────────────────────────────────────────────────────────

function FuelPane({
  stations,
  onOpen,
}: {
  stations: FillingStation[];
  onOpen: (s: FillingStation) => void;
}) {
  const ios = useIOSTheme();

  if (stations.length === 0) {
    return (
      <EmptyPane
        symbol="fuelpump"
        title="No stations found"
        body="No filling stations are mapped within range. Data comes from OpenStreetMap, so coverage varies by area."
      />
    );
  }

  return (
    <View style={styles.list}>
      {stations.map((station) => (
        <Pressable key={station.id} onPress={() => onOpen(station)} style={styles.card}>
          <Glass
            variant="regular"
            radius={CARD_RADIUS}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            fallbackIntensity={40}
            fallbackTint={ios.scheme === "dark" ? "rgba(255,255,255,0.06)" : "#FFFFFF"}
          />
          <View style={[styles.fuelTile, { backgroundColor: Colors.goldLight + "12"}]}>
            <SymbolView name="fuelpump.fill" size={20} tintColor={Colors.gold} fallback={null} />
          </View>

          <View style={styles.cardText}>
            <Text numberOfLines={1} style={[IOSAppFont.label, { color: ios.label }]}>
              {station.name}
            </Text>
            {!!station.brand && station.brand !== station.name && (
              <>
                <Text numberOfLines={1} style={[IOSAppFont.description, { color: ios.secondaryLabel }]}>
                  {station.brand}
                </Text>
                <Distance km={station.distance_km} />
              </>
            )}
          </View>
                <Distance km={station.distance_km} />

        </Pressable>
      ))}

      {/* Attribution is a condition of using OSM data, not a courtesy. */}
      {/* <Text style={[IOSAppFont.description, styles.attribution, { color: ios.tertiaryLabel }]}>
        Station data © OpenStreetMap contributors
      </Text> */}
    </View>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function Distance({ km }: { km: number }) {
  const ios = useIOSTheme();
  const label = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  return (
    <Text style={[IOSAppFont.description, styles.distance, { color: ios.secondaryLabel }]}>
      {label}
    </Text>
  );
}

function EmptyPane({ symbol, title, body }: { symbol: string; title: string; body: string }) {
  const ios = useIOSTheme();
  return (
    <View style={styles.empty}>
      <SymbolView name={symbol as never} size={50} tintColor={ios.tertiaryLabel} fallback={null} />
      <Text style={[IOSAppFont.label, { color: ios.label }]}>{title}</Text>
      <Text style={[IOSAppFont.description, styles.centre, { color: ios.tertiaryLabel }]}>
        {body}
      </Text>
    </View>
  );
}

const CARD_RADIUS = 24;

const styles = StyleSheet.create({
  strip: { paddingBottom: 14 },
  staleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 12,
    alignSelf: 'center'
  },
  list: { gap: 13, paddingBottom: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 14,
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
  },
  cardText: { flex: 1, gap: 1 },
  distance: { marginTop: 0 },
  offerCard: {
    padding: 16,
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
    gap: 12,
  },
  offerHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  route: {},
  fareRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  fareNow: { fontFamily: "Poppins_700Bold", fontSize: 20 },
  fareWas: {
    fontFamily: "Poppins_400Regular",
    fontSize: 13,
    textDecorationLine: "line-through",
  },
  savePill: {
    backgroundColor: Colors.primary,
    borderRadius: 30,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  saveText: { fontFamily: "Poppins_600SemiBold", fontSize: 11, color: "#FFFFFF" },
  seats: { marginTop: 0, marginLeft: "auto" },
  fuelTile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { alignItems: "center", paddingTop: 160, paddingHorizontal: 30, gap: 12,  },
  centre: { textAlign: "center" },
  attribution: { textAlign: "center", paddingTop: 8 },
});
