// app/games/redlight.tsx
//
// EMILGO Games · Red Light, Green Light, full screen.
//
// The game is a web page (the same one Lagos Life frames), embedded in the app
// as a single HTML string so it opens instantly and plays offline. This screen
// is only its host: it injects boot data, persists the game's settings, turns
// the game's haptic requests into real taptics, and tells it when the app goes
// to the background or the Android back button is pressed.
//
// Rebuild the embedded game with `npm run game:embed`.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Platform, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { REDLIGHT_HTML } from "@/src/games/emilgo-games/redlightHtml.generated";
import {
  GAMES_KEYS,
  GAMES_STORAGE_PREFIX,
  hostMessage,
  parseGameMessage,
  withBoot,
  type GameMessage,
  type GameBoot,
} from "@/src/games/emilgo-games/bridge";
import { useAuthStore } from "@/src/store/useStore";
import { haptics } from "@/src/utils/haptics";

const NAVY = "#16203c";

// Online rounds need the EMILGO Games server. It must be wss:// — the page runs
// on an https origin, and WebViews block insecure sockets from secure pages.
// Unset, the game simply shows Online as unavailable.
const GAMES_SERVER = process.env.EXPO_PUBLIC_GAMES_SERVER?.trim() || undefined;

export default function RedLightScreen() {
  const user = useAuthStore((s) => s.user);
  const [saved, setSaved] = useState<Record<string, string> | null>(null);
  const web = useRef<WebView>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);

  // Load what the game saved last time before we build its page.
  useEffect(() => {
    let alive = true;
    AsyncStorage.multiGet(GAMES_KEYS.map((k) => GAMES_STORAGE_PREFIX + k))
      .then((pairs) => {
        const out: Record<string, string> = {};
        for (const [k, v] of pairs) if (v != null) out[k.slice(GAMES_STORAGE_PREFIX.length)] = v;
        if (alive) setSaved(out);
      })
      .catch(() => alive && setSaved({}));
    return () => {
      alive = false;
    };
  }, []);

  // First name only: it is a greeting, not an identity.
  const name = (user?.first_name || user?.full_name?.split(" ")[0] || user?.username || "").slice(0, 24);

  const html = useMemo(() => {
    if (!saved) return null;
    const boot: GameBoot = { host: "emilgo", v: 1, name: name || undefined, saved, server: GAMES_SERVER };
    return withBoot(REDLIGHT_HTML, boot);
    // The page is built once per visit; later name changes don't reload the game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const send = useCallback((type: "pause" | "resume" | "back") => {
    const msg = hostMessage(type);
    if (Platform.OS === "web") frame.current?.contentWindow?.postMessage(msg, "*");
    else web.current?.postMessage(msg);
  }, []);

  const onGameMessage = useCallback((m: GameMessage) => {
    switch (m.type) {
      case "haptic": {
        const map = {
          tap: haptics.tap,
          select: haptics.select,
          warning: haptics.warning,
          success: haptics.success,
          heavy: haptics.heavy,
          error: haptics.error,
        } as const;
        (map[m.kind] ?? haptics.tap)();
        break;
      }
      case "save":
        AsyncStorage.setItem(GAMES_STORAGE_PREFIX + m.key, m.value).catch(() => {});
        break;
      case "exit":
        if (router.canGoBack()) router.back();
        else router.replace("/(main)");
        break;
      case "ready":
        break;
    }
  }, []);

  // App to background → the game pauses (and stops its sound); back → resumes.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      send(state === "active" ? "resume" : "pause");
    });
    return () => sub.remove();
  }, [send]);

  // Android back: let the game decide (pause menu first, then close).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      send("back");
      return true;
    });
    return () => sub.remove();
  }, [send]);

  // EMILGO's web build: an iframe instead of a WebView.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = parseGameMessage(e.data);
      if (m) onGameMessage(m);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onGameMessage]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const m = parseGameMessage(e.nativeEvent.data);
      if (m) onGameMessage(m);
    },
    [onGameMessage],
  );

  return (
    <View style={styles.root}>
      <StatusBar hidden style="light" />
      {!html ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#ffd700" />
        </View>
      ) : Platform.OS === "web" ? (
        React.createElement("iframe", {
          ref: frame,
          srcDoc: html,
          title: "Red Light, Green Light",
          allow: "autoplay",
          style: { border: 0, width: "100%", height: "100%", background: NAVY },
        })
      ) : (
        <WebView
          ref={web}
          style={styles.web}
          source={{ html, baseUrl: "https://games.emilgo.local/" }}
          originWhitelist={["*"]}
          onMessage={onMessage}
          // The page is self-contained: it must never navigate anywhere.
          onShouldStartLoadWithRequest={(req) => req.url.startsWith("https://games.emilgo.local") || req.url.startsWith("about:")}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsBackForwardNavigationGestures={false}
          bounces={false}
          scrollEnabled={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          textZoom={100}
          androidLayerType="hardware"
          webviewDebuggingEnabled={__DEV__}
          // A crashed renderer (e.g. memory pressure on a low-end phone) reloads
          // instead of leaving a dead white screen.
          onContentProcessDidTerminate={() => web.current?.reload()}
          onRenderProcessGone={() => web.current?.reload()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  web: { flex: 1, backgroundColor: NAVY },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
