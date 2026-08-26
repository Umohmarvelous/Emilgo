// app/free-ride-track/[claimId].tsx
//
// Live tracking for a free ride. GPS here is compulsory, not optional: the
// recorded track is what backs the driver's fuel reward, so the screen refuses
// to run without a fix and warns loudly if location is switched off mid-ride.
//
// Ending the ride stops tracking and writes the track to `route_history`, where
// a DB trigger decides whether it counts as GPS-validated. Wiring that result
// through to fuel redemption / receipts is the next step in the plan.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  AppState,
  Platform,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";

import {
  ensureGpsOn,
  startLocationTracking,
  stopLocationTracking,
  type TrackingSummary,
} from "@/src/services/locationTracking";
import { useAuthStore, useTripStore } from "@/src/store/useStore";
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { haptics } from "@/src/utils/haptics";
import {
  useFreeRidesStore,
  describeCompletion,
  type FreeRideCompletion,
} from "@/src/store/useFreeRidesStore";
import Receipt, { type ReceiptData } from "@/components/Receipt";
import { freeRideToReceipt } from "@/src/utils/activity";
import { Colors } from "@/constants/colors";
import { MAP_PROVIDER } from "@/src/utils/maps";
import { formatDistance, formatDuration, formatNaira } from "@/src/utils/helpers";
import { iosAlert } from "@/components/ios";

/** How often to re-check that device location services are still on. */
const GPS_WATCHDOG_MS = 8000;

const MAP_STYLE = [
  { elementType: "geometry",           stylers: [{ color: "#0f1b14" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a1210" }] },
  { elementType: "labels.text.fill",   stylers: [{ color: "#6aad7a" }] },
  { featureType: "road",     elementType: "geometry", stylers: [{ color: "#1d3827" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#274d36" }] },
  { featureType: "water",    elementType: "geometry", stylers: [{ color: "#0a1610" }] },
  { featureType: "poi",      elementType: "geometry", stylers: [{ color: "#152219" }] },
];

type Phase = "checking" | "blocked" | "tracking" | "ended";

export default function FreeRideTrackScreen() {
  const { claimId, mode, origin, destination, role } = useLocalSearchParams<{
    claimId:      string;
    mode?:        string;
    origin?:      string;
    destination?: string;
    role?:        string;
  }>();

  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  const currentLocation = useTripStore((s) => s.currentLocation);
  const routeCoordinates = useTripStore((s) => s.routeCoordinates);
  const tripDistanceKm = useTripStore((s) => s.tripDistanceKm);
  const speed = useTripStore((s) => s.speed);
  const resetTripState = useTripStore((s) => s.resetTripState);

  const completeRide = useFreeRidesStore((s) => s.completeRide);
  const autoStartTracking = useSettingsStore((s) => s.autoStartTracking);
  const confirmEndTrip = useSettingsStore((s) => s.confirmEndTrip);

  const [phase,      setPhase]      = useState<Phase>("checking");
  const [gpsLost,    setGpsLost]    = useState(false);
  const [elapsed,    setElapsed]    = useState(0);
  const [summary,    setSummary]    = useState<TrackingSummary | null>(null);
  const [ending,     setEnding]     = useState(false);
  const [completion, setCompletion] = useState<FreeRideCompletion | null>(null);
  const [receipt,    setReceipt]    = useState<ReceiptData | null>(null);
  const [showReceipt,setShowReceipt]= useState(false);
  // True once begin() has actually run, so the gate can tell a manual start
  // apart from a failed GPS attempt.
  const [hasAttemptedStart, setHasAttemptedStart] = useState(false);

  const mapRef    = useRef<MapView>(null);
  const startedAt = useRef<number>(0);
  const phaseRef  = useRef<Phase>("checking");
  phaseRef.current = phase;

  const isDriver = (role ?? user?.role) === "driver";

  // ── Start: GPS is a precondition, so check before anything else ────────────
  const begin = useCallback(async () => {
    setHasAttemptedStart(true);
    setPhase("checking");
    const gps = await ensureGpsOn();
    if (!gps.ok) {
      setPhase("blocked");
      return;
    }

    resetTripState();
    try {
      await startLocationTracking({
        sessionId:   claimId,
        context:     "free_ride",
        role:        isDriver ? "driver" : "passenger",
        compulsory:  true,
        farePerKm:   0, // free ride — no fare accrues
        claimId,
        originLabel: origin ?? null,
        destLabel:   destination ?? null,
      });
      startedAt.current = Date.now();
      setElapsed(0);
      setGpsLost(false);
      setPhase("tracking");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setPhase("blocked");
      console.log('first',e)
    }
  }, [claimId, destination, isDriver, origin, resetTripState]);

  useEffect(() => {
    // Settings → "Start tracking automatically". Off means the rider taps to
    // begin; GPS is still compulsory for the ride either way, so this only
    // controls *when* recording starts, never whether it happens.
    if (autoStartTracking) begin();
    else setPhase("blocked");

    // Stop tracking if the screen goes away mid-ride; the checkpoint on disk
    // means the partial track is still recoverable.
    return () => {
      void stopLocationTracking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "tracking") return;
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [phase]);

  // ── Watchdog: location must stay on for the whole ride ────────────────────
  useEffect(() => {
    if (phase !== "tracking") return;

    const check = async () => {
      const gps = await ensureGpsOn({ request: false });
      setGpsLost(!gps.ok);
    };

    const t = setInterval(check, GPS_WATCHDOG_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && phaseRef.current === "tracking") void check();
    });

    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [phase]);

  // ── Follow the vehicle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentLocation || phase !== "tracking") return;
    mapRef.current?.animateCamera(
      {
        center:  { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
        zoom:    17,
        heading: currentLocation.heading || 0,
      },
      { duration: 800 },
    );
  }, [currentLocation, phase]);

  // ── End ───────────────────────────────────────────────────────────────────
  const confirmEnd = useCallback(() => {
    haptics.press();

    const finish = async () => {
      {
          setEnding(true);

          // Stop first: this uploads the track and gives us the route_history id
          // the server needs to verify the ride.
          const result = await stopLocationTracking();
          setSummary(result);

          let outcome: FreeRideCompletion | null = null;
          if (result?.routeHistoryId) {
            outcome = await completeRide({
              claimId,
              routeId:    result.routeHistoryId,
              distanceKm: result.distanceKm,
            });
            setCompletion(outcome);
            setReceipt(
              freeRideToReceipt({
                claimId,
                mode:          outcome.mode ?? (mode === "barter" ? "barter" : "reward"),
                outcome:       describeCompletion(outcome),
                gpsValidated:  outcome.gpsValidated,
                fuelAwarded:   outcome.fuelAwarded,
                distanceKm:    result.distanceKm,
                durationLabel: formatDuration(result.durationSeconds),
                pointCount:    result.pointCount,
              }),
            );
          }

          setEnding(false);
          setPhase("ended");
          if (outcome?.gpsValidated) haptics.success();
          else haptics.warning();
      }
    };

    // Settings → "Confirm before ending a ride". Off means one tap ends it.
    if (!confirmEndTrip) {
      void finish();
      return;
    }

    iosAlert("End this free ride?", "Tracking stops and the route is recorded.", [
      { text: "Keep riding", style: "cancel" },
      { text: "End ride", style: "destructive", onPress: () => void finish() },
    ]);
  }, [claimId, completeRide, confirmEndTrip, mode]);

  const exit = useCallback(() => {
    const id = summary?.routeHistoryId;
    resetTripState();
    if (id) router.replace(`/route-history/${id}`);
    else router.replace("/route-history");
  }, [resetTripState, summary?.routeHistoryId]);

  const topPad = Platform.OS === "web" ? 20 : insets.top;

  // Server verdict if we got one; otherwise fall back to the on-device estimate.
  const verified = completion ? completion.gpsValidated : !!summary?.gpsValidated;

  // Distinguishes "you turned auto-start off" from "we couldn't get a GPS fix":
  // both land on the gate screen, but they need different copy and a different
  // button. Manual start means we never attempted tracking yet.
  const awaitingManualStart = !autoStartTracking && !hasAttemptedStart;

  // ── Blocked: no GPS, no ride ──────────────────────────────────────────────
  if (phase === "checking" || phase === "blocked") {
    return (
      <View style={styles.gate}>
        <StatusBar style="light" />
        <View style={styles.gateIcon}>
          <Ionicons
            name={phase === "blocked" ? "location-outline" : "navigate-outline"}
            size={36}
            color={Colors.primary}
          />
        </View>

        {phase === "checking" ? (
          <>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.gateTitle}>Getting a GPS fix…</Text>
          </>
        ) : (
          <>
            <Text style={styles.gateTitle}>
              {awaitingManualStart ? "Ready when you are" : "Location is required"}
            </Text>
            <Text style={styles.gateSub}>
              {awaitingManualStart
                ? "Auto-start is off in your settings, so tap below when the ride begins. GPS tracking is still required for a free ride."
                : "Free rides are GPS-tracked from pickup to drop-off — that record is what earns the driver their fuel reward. Turn on location for Emilgo, then try again."}
            </Text>
            <Pressable style={styles.gateBtn} onPress={begin}>
              <Ionicons name={awaitingManualStart ? "play" : "refresh"} size={17} color="#fff" />
              <Text style={styles.gateBtnText}>
                {awaitingManualStart ? "Start tracking" : "Try again"}
              </Text>
            </Pressable>
            <Pressable style={styles.gateCancel} onPress={() => router.back()}>
              <Text style={styles.gateCancelText}>Cancel</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={MAP_PROVIDER}
        customMapStyle={MAP_STYLE}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        rotateEnabled={false}
      >
        {routeCoordinates.length > 1 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor={Colors.primary}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {currentLocation && (
          <Marker
            coordinate={{
              latitude:  currentLocation.latitude,
              longitude: currentLocation.longitude,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
          >
            <View style={styles.marker}>
              <Ionicons name="navigate" size={16} color="#fff" />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: topPad + 10 }]}>
        <Pressable style={styles.topBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>

        <View style={styles.tripTag}>
          <View style={styles.liveDot} />
          <Text style={styles.tripTagText}>
            {mode === "barter" ? "Barter ride" : "Free ride"} · tracked
          </Text>
        </View>

        <View style={{ width: 40 }} />
      </View>

      {/* GPS-lost warning */}
      {gpsLost && phase === "tracking" && (
        <View style={[styles.warnBar, { top: topPad + 62 }]}>
          <Ionicons name="warning" size={16} color="#fff" />
          <Text style={styles.warnText}>
            {`Location is off — turn GPS back on or this ride won't be verified.`}
          </Text>
        </View>
      )}

      {/* Bottom panel */}
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 18) + 14 }]}>
        {phase === "tracking" ? (
          <>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatDistance(tripDistanceKm)}</Text>
                <Text style={styles.statLabel}>Distance</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatDuration(elapsed)}</Text>
                <Text style={styles.statLabel}>Elapsed</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{Math.round(speed * 3.6)}</Text>
                <Text style={styles.statLabel}>km/h</Text>
              </View>
            </View>

            <View style={styles.freeNote}>
              <Ionicons name="gift-outline" size={14} color={Colors.primary} />
              <Text style={styles.freeNoteText}>No fare — this ride is free</Text>
            </View>

            <Pressable
              style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.85 }]}
              onPress={confirmEnd}
              disabled={ending}
            >
              {ending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="stop-circle" size={19} color="#fff" />
                  <Text style={styles.endBtnText}>End ride</Text>
                </>
              )}
            </Pressable>
          </>
        ) : (
          <>
            {/* The server's verdict wins — the on-device estimate is only a hint. */}
            <View style={[styles.resultBadge, verified ? styles.resultOk : styles.resultWarn]}>
              <Ionicons
                name={verified ? "shield-checkmark" : "alert-circle"}
                size={18}
                color={verified ? Colors.primary : Colors.warning}
              />
              <Text
                style={[styles.resultText, { color: verified ? Colors.primary : Colors.warning }]}
              >
                {verified ? "Ride tracked and GPS-verified" : "Ride recorded, not verified"}
              </Text>
            </View>

            <Text style={styles.outcomeText}>
              {completion
                ? describeCompletion(completion)
                : "The ride was recorded on this device but couldn't be confirmed with the server. It will sync when you're back online."}
            </Text>

            {(completion?.fuelAwarded ?? 0) > 0 && (
              <View style={styles.fuelRow}>
                <Ionicons name="flame" size={17} color={Colors.gold} />
                <Text style={styles.fuelText}>
                  {formatNaira(completion!.fuelAwarded)} free fuel credited
                </Text>
              </View>
            )}

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatDistance(summary?.distanceKm ?? 0)}</Text>
                <Text style={styles.statLabel}>Distance</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {formatDuration(summary?.durationSeconds ?? 0)}
                </Text>
                <Text style={styles.statLabel}>Duration</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{summary?.pointCount ?? 0}</Text>
                <Text style={styles.statLabel}>GPS fixes</Text>
              </View>
            </View>

            {receipt && (
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
                onPress={() => setShowReceipt(true)}
              >
                <Ionicons name="receipt-outline" size={17} color={Colors.primary} />
                <Text style={styles.secondaryBtnText}>View receipt</Text>
              </Pressable>
            )}

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
              onPress={exit}
            >
              <Ionicons name="map-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>View the route</Text>
            </Pressable>
          </>
        )}
      </View>

      <Receipt visible={showReceipt} data={receipt} onClose={() => setShowReceipt(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a1210" },

  // Gate
  gate: {
    flex:             1,
    backgroundColor:  "#0a1210",
    alignItems:       "center",
    justifyContent:   "center",
    paddingHorizontal:36,
    gap:              14,
  },
  gateIcon: {
    width:           76,
    height:          76,
    borderRadius:    24,
    backgroundColor: "rgba(0,154,67,0.12)",
    borderWidth:     1,
    borderColor:     "rgba(0,154,67,0.3)",
    alignItems:      "center",
    justifyContent:  "center",
  },
  gateTitle: { fontFamily: "Poppins_700Bold", fontSize: 19, color: "#fff", textAlign: "center" },
  gateSub: {
    fontFamily: "Poppins_400Regular",
    fontSize:   13,
    lineHeight: 20,
    color:      "rgba(255,255,255,0.65)",
    textAlign:  "center",
  },
  gateBtn: {
    flexDirection:    "row",
    alignItems:       "center",
    justifyContent:   "center",
    gap:              8,
    backgroundColor:  Colors.primary,
    borderRadius:     14,
    paddingVertical:  14,
    paddingHorizontal:28,
    marginTop:        6,
  },
  gateBtnText:    { fontFamily: "Poppins_600SemiBold", fontSize: 15, color: "#fff" },
  gateCancel:     { paddingVertical: 8 },
  gateCancelText: { fontFamily: "Poppins_400Regular", fontSize: 14, color: "rgba(255,255,255,0.5)" },

  // Map chrome
  marker: {
    width:           32,
    height:          32,
    borderRadius:    16,
    backgroundColor: Colors.primary,
    alignItems:      "center",
    justifyContent:  "center",
    borderWidth:     3,
    borderColor:     "rgba(255,255,255,0.9)",
  },
  topBar: {
    position:         "absolute",
    top:              0,
    left:             0,
    right:            0,
    flexDirection:    "row",
    alignItems:       "center",
    justifyContent:   "space-between",
    paddingHorizontal:16,
    zIndex:           10,
  },
  topBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems:      "center",
    justifyContent:  "center",
  },
  tripTag: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              7,
    backgroundColor:  "rgba(0,0,0,0.6)",
    paddingHorizontal:14,
    paddingVertical:  8,
    borderRadius:     20,
    borderWidth:      1,
    borderColor:      "rgba(0,154,67,0.35)",
  },
  liveDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary },
  tripTagText: { fontFamily: "Poppins_600SemiBold", fontSize: 12, color: "#fff" },

  warnBar: {
    position:         "absolute",
    left:             16,
    right:            16,
    flexDirection:    "row",
    alignItems:       "center",
    gap:              9,
    backgroundColor:  Colors.error,
    paddingHorizontal:14,
    paddingVertical:  11,
    borderRadius:     14,
    zIndex:           10,
  },
  warnText: { flex: 1, fontFamily: "Poppins_500Medium", fontSize: 12, color: "#fff", lineHeight: 17 },

  // Panel
  panel: {
    position:             "absolute",
    bottom:               0,
    left:                 0,
    right:                0,
    backgroundColor:      "rgba(15,27,20,0.97)",
    borderTopLeftRadius:  28,
    borderTopRightRadius: 28,
    borderTopWidth:       1,
    borderTopColor:       "rgba(0,154,67,0.25)",
    paddingTop:           22,
    paddingHorizontal:    24,
    gap:                  16,
  },
  statsRow:    { flexDirection: "row", alignItems: "center" },
  stat:        { flex: 1, alignItems: "center", gap: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.09)" },
  statValue:   { fontFamily: "Poppins_700Bold", fontSize: 19, color: "#fff" },
  statLabel: {
    fontFamily:    "Poppins_500Medium",
    fontSize:      10,
    color:         "rgba(255,255,255,0.5)",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  freeNote: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            7,
  },
  freeNoteText: { fontFamily: "Poppins_500Medium", fontSize: 12, color: Colors.primary },

  endBtn: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
    backgroundColor:Colors.error,
    borderRadius:   16,
    height:         54,
  },
  endBtnText: { fontFamily: "Poppins_700Bold", fontSize: 16, color: "#fff" },

  resultBadge: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
    paddingVertical:12,
    borderRadius:   14,
    borderWidth:    1,
  },
  resultOk:   { backgroundColor: "rgba(0,154,67,0.12)",  borderColor: "rgba(0,154,67,0.35)" },
  resultWarn: { backgroundColor: "rgba(245,166,35,0.12)", borderColor: "rgba(245,166,35,0.35)" },
  resultText: { fontFamily: "Poppins_600SemiBold", fontSize: 13 },

  outcomeText: {
    fontFamily: "Poppins_400Regular",
    fontSize:   12,
    lineHeight: 18,
    color:      "rgba(255,255,255,0.62)",
    textAlign:  "center",
  },
  fuelRow: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            7,
  },
  fuelText: { fontFamily: "Poppins_700Bold", fontSize: 15, color: Colors.gold },

  secondaryBtn: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
    borderRadius:   16,
    height:         50,
    borderWidth:    1.5,
    borderColor:    Colors.primary,
  },
  secondaryBtnText: { fontFamily: "Poppins_600SemiBold", fontSize: 14, color: Colors.primary },

  primaryBtn: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
    backgroundColor:Colors.primary,
    borderRadius:   16,
    height:         54,
  },
  primaryBtnText: { fontFamily: "Poppins_600SemiBold", fontSize: 15, color: "#fff" },
});
