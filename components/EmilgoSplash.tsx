// /**
//  * EmilgoSplash.tsx — Animated splashscreen overlay for the Emilgo app (Expo / React Native)

//  * TIMELINE (spec):
//  *   0.0–0.3s  logo settles in, centered          (ease-out pop)
//  *   0.3–1.2s  logo slides left, "Emilgo" reveals  (cubic ease-in-out)
//  *   1.2–4.2s  hold
//  *   4.2–5.2s  name fades out, logo returns center (cubic ease-in-out)
//  *   5.2–5.8s  gentle zoom-in, background dims     (ease-out)
//  *   5.8–6.7s  exponential zoom-through → app      (ease-in expo, X-style)
//  *
//  * PRODUCTION NOTE: 6.7s is long for a splash. For daily-use feel, consider the
//  * FAST timings in the TIMING constant below (≈3.5s, same choreography).
//  */

// import React, { useEffect, useState } from 'react';
// import { Dimensions, StyleSheet } from 'react-native';
// import Animated, {
//   Easing,
//   runOnJS,
//   useAnimatedStyle,
//   useSharedValue,
//   withDelay,
//   withSequence,
//   withTiming,
// } from 'react-native-reanimated';

// const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// // ---- Brand assets -------------------------------------------------------------
// // White logo variant (transparent PNG, 540×871) — shipped alongside this file.
// // eslint-disable-next-line @typescript-eslint/no-var-requires
// const LOGO = require('../assets/images/emilgo_logo_white.png');

// const LOGO_H = 90;
// // const LOGO_W = 90;
// const LOGO_W = LOGO_H * (540 / 871); // ≈ 93, preserves asset aspect ratio
// const COVER = Math.max(SCREEN_W / LOGO_W, SCREEN_H / LOGO_H) * 1.35; // scale that fills the screen

// // ---- Timing -------------------------------------------------------------------
// // SPEC (as briefed, 6.7s total) — or switch to FAST (≈3.5s) for production.
// const TIMING = {
//   SPEC: { in: 300, reveal: 900, hold: 3000, retract: 1000, preZoom: 600, zoom: 900 },
//   FAST: { in: 250, reveal: 650, hold: 1200,  retract: 550,  preZoom: 100, zoom: 200 },
// } as const;
// const T = TIMING.FAST;

// const t0 = T.in;                          // reveal starts
// const t1 = t0 + T.reveal;                 // reveal done → hold starts
// const t2 = t1 + T.hold;                   // retract starts
// const t3 = t2 + T.retract;                // retract done → preZoom starts
// const t4 = t3 + T.preZoom;                // zoom-through starts
// // const END = t4 + T.zoom;                  // total

// const INOUT = Easing.inOut(Easing.cubic);

// interface Props {
//   onFinish?: () => void;
//   backgroundColor?: string; // must match app.json splash.backgroundColor
// }

// export default function EmilgoSplash({ onFinish, backgroundColor = '#009A43' }: Props) {
//   const [wordW, setWordW] = useState(0);

//   const logoOpacity = useSharedValue(0);
//   const brandScale  = useSharedValue(0.92);
//   const reveal      = useSharedValue(0);   // 0 → 1 → 0 (wordmark open / close)
//   const wordOpacity = useSharedValue(0);
//   const wordShiftX  = useSharedValue(26);  // px, wordmark slides in from the right
//   const dimOpacity  = useSharedValue(0);
//   const overlayFade = useSharedValue(1);

//   useEffect(() => {
//     // 1a — logo settles in
//     logoOpacity.value = withTiming(1, { duration: T.in, easing: Easing.out(Easing.cubic) });

//     // full zoom choreography on one shared value (keeps 1a/2a/2b perfectly continuous)
//     brandScale.value = withSequence(
//       withTiming(1, { duration: T.in, easing: Easing.out(Easing.cubic) }),          // pop-in
//       withDelay(t3 - T.in, withTiming(1.55, { duration: T.preZoom, easing: Easing.out(Easing.cubic) })), // 2a gentle zoom
//       withTiming(COVER, { duration: T.zoom, easing: Easing.in(Easing.exp) })        // 2b X-style fill
//     );

//     // 1b / 1d — wordmark opens, holds, closes
//     reveal.value = withSequence(
//       withDelay(t0, withTiming(1, { duration: T.reveal, easing: INOUT })),
//       withDelay(T.hold, withTiming(0, { duration: T.retract, easing: INOUT }))
//     );
//     wordOpacity.value = withSequence(
//       withDelay(t0 + 120, withTiming(1, { duration: T.reveal * 0.65, easing: Easing.out(Easing.cubic) })),
//       withDelay(T.hold + (T.reveal * 0.35 - 120), withTiming(0, { duration: T.retract * 0.72 }))
//     );
//     wordShiftX.value = withSequence(
//       withDelay(t0 + 120, withTiming(0, { duration: T.reveal * 0.75, easing: Easing.out(Easing.cubic) })),
//       withDelay(T.hold + (T.reveal * 0.25 - 120), withTiming(-26, { duration: T.retract * 0.72 }))
//     );

//     // 2a — background dims to focus the logo
//     dimOpacity.value = withDelay(t3, withTiming(0.35, { duration: T.preZoom }));

//     // 2c — splash dissolves into the app
//     overlayFade.value = withDelay(
//       t4 + T.zoom * 0.6,
//       withTiming(0, { duration: T.zoom * 0.55 }, (finished) => {
//         if (finished && onFinish) runOnJS(onFinish)();
//       })
//     );
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   const logoStyle = useAnimatedStyle(() => ({ opacity: logoOpacity.value }));
//   const brandStyle = useAnimatedStyle(() => ({ transform: [{ scale: brandScale.value }] }));
//   const wordWrapStyle = useAnimatedStyle(() => ({ width: reveal.value * wordW }));
//   const wordStyle = useAnimatedStyle(() => ({
//     opacity: wordOpacity.value,
//     transform: [{ translateX: wordShiftX.value }],
//   }));
//   const dimStyle = useAnimatedStyle(() => ({ opacity: dimOpacity.value }));
//   const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayFade.value }));

//   return (
//     <Animated.View style={[styles.overlay, { backgroundColor }, overlayStyle]}>
//       <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />

//       <Animated.View style={[styles.brand, brandStyle]}>
//         <Animated.Image source={LOGO} style={[styles.logo, logoStyle]} resizeMode="contain" />
//         <Animated.View style={[styles.wordWrap, wordWrapStyle]}>
//           <Animated.Text style={[styles.word, wordStyle]} numberOfLines={1}>
//             milgo
//           </Animated.Text>
//         </Animated.View>
//       </Animated.View>

//       {/* invisible twin used once to measure the wordmark's natural width */}
//       <Animated.Text
//         style={[styles.word, styles.measure]}
//         onLayout={(e) => setWordW(e.nativeEvent.layout.width)}
//       >
//         milgo
//       </Animated.Text>
//     </Animated.View>
//   );
// }

// const styles = StyleSheet.create({
//   overlay: {
//     position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
//     alignItems: 'center',
//     justifyContent: 'center',
//     zIndex: 999,
//   },
//   dim: { backgroundColor: '#009A43' },
//   brand: { flexDirection: 'row', alignItems: 'center'},
//   logo: { width: LOGO_W, height: LOGO_H },
//   wordWrap: { overflow: 'hidden', justifyContent: 'center' },
//   word: {
//     paddingLeft: 20,
//     fontSize: 25,
//     fontWeight: '800', // pair with Montserrat-ExtraBold via expo-font for the exact preview look
//     color: '#fff',
//     letterSpacing: 0.5,
//     includeFontPadding: false,

//   },
//   measure: { position: 'absolute', opacity: 0, left: -9999, top: 0 },
// });


























// /**
//  * EmilgoSplash.tsx — Animated splashscreen overlay for the Emilgo app (Expo / React Native)
//  *
//  * TIMELINE (FAST ≈ 3.0 s):
//  *   0.0–0.25s  logo pops in, centred
//  *   0.25–0.90s logo nudges left, "milgo" slides out from behind it (whole text)
//  *   0.90–2.10s hold
//  *   2.10–2.65s wordmark slides back behind logo, logo returns centre
//  *   2.65–2.77s quick shrink anticipation (Twitter-style dip)
//  *   2.77–3.05s exponential zoom-through → app
//  */

// import React, { useEffect, useRef, useState } from 'react';
// import { Dimensions, StyleSheet } from 'react-native';
// import Animated, {
//   Easing,
//   runOnJS,
//   useAnimatedStyle,
//   useSharedValue,
//   withDelay,
//   withSequence,
//   withTiming,
// } from 'react-native-reanimated';

// const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// // ---- Brand assets -------------------------------------------------------------
// // eslint-disable-next-line @typescript-eslint/no-var-requires
// const LOGO = require('../assets/images/emilgo_logo_white.png');

// const LOGO_H = 95;
// const LOGO_W = LOGO_H * (540 / 871); // ≈ 56
// const COVER = Math.max(SCREEN_W / LOGO_W, SCREEN_H / LOGO_H) * 1.35;

// // How many pixels the wordmark tucks behind the logo (tight spacing)
// const OVERLAP = 0;

// // ---- Timing -------------------------------------------------------------------
// const TIMING = {
//   SPEC: { in: 300, reveal: 900, hold: 3000, retract: 1000, shrink: 150, zoom: 900 },
//   // FAST: { in: 250, reveal: 650, hold: 1200, retract: 550, shrink: 120, zoom: 280 },

//   FAST: { in: 1050, reveal: 650, hold: 1100, retract: 550, shrink: 450,  zoom: 300 },
// } as const;
// const T = TIMING.FAST;

// const t0 = T.in;               // reveal starts
// const t1 = t0 + T.reveal;      // reveal done → hold starts
// const t2 = t1 + T.hold;        // retract starts
// const t3 = t2 + T.retract;     // retract done → shrink starts
// const t4 = t3 + T.shrink;      // zoom-through starts

// const INOUT = Easing.inOut(Easing.cubic);

// interface Props {
//   onFinish?: () => void;
//   backgroundColor?: string; // must match app.json splash.backgroundColor
// }

// export default function EmilgoSplash({ onFinish, backgroundColor = '#009A43' }: Props) {
//   const [wordW, setWordW] = useState(0);
//   const onFinishRef = useRef(onFinish);
//   onFinishRef.current = onFinish;

//   const logoOpacity = useSharedValue(0);
//   const brandScale  = useSharedValue(0.92);
//   const wordShiftX  = useSharedValue(0);
//   const brandShiftX = useSharedValue(0);
//   const dimOpacity  = useSharedValue(0);
//   const overlayFade = useSharedValue(1);

//   useEffect(() => {
//     if (wordW === 0) return;

//     // Offset that keeps the combined logo+wordmark centred on screen
//     const centreOffset = -(wordW - OVERLAP) / 2;

//     // 1a — logo settles in
//     logoOpacity.value = withTiming(1, { duration: T.in, easing: Easing.out(Easing.cubic) });

//     // Scale choreography: pop-in → hold → shrink anticipation → zoom-through
//     brandScale.value = withSequence(
//       withTiming(1, { duration: T.in, easing: Easing.out(Easing.cubic) }),
//       withDelay(t3 - T.in, withTiming(0.88, { duration: T.shrink, easing: Easing.out(Easing.cubic) })),
//       withTiming(COVER, { duration: T.zoom, easing: Easing.in(Easing.exp) })
//     );

//     // Wordmark slides out from behind the logo as one solid unit
//     wordShiftX.value = -wordW;
//     wordShiftX.value = withSequence(
//       withDelay(t0, withTiming(0, { duration: T.reveal, easing: INOUT })),
//       withDelay(T.hold, withTiming(-wordW, { duration: T.retract, easing: INOUT }))
//     );

//     // Nudge the whole brand so the combined mark stays centred while the word appears
//     brandShiftX.value = withSequence(
//       withDelay(t0, withTiming(centreOffset, { duration: T.reveal, easing: INOUT })),
//       withDelay(T.hold, withTiming(0, { duration: T.retract, easing: INOUT }))
//     );

//     // Background dims during the shrink beat
//     dimOpacity.value = withDelay(t3, withTiming(0.35, { duration: T.shrink }));

//     // Splash dissolves into the app
//     overlayFade.value = withDelay(
//       t4 + T.zoom * 0.6,
//       withTiming(0, { duration: T.zoom * 0.5 }, (finished) => {
//         if (finished && onFinishRef.current) runOnJS(onFinishRef.current)();
//       })
//     );
//   }, [wordW]);

//   const logoStyle = useAnimatedStyle(() => ({ opacity: logoOpacity.value }));
//   const brandStyle = useAnimatedStyle(() => ({
//     transform: [{ scale: brandScale.value }, { translateX: brandShiftX.value }],
//   }));
//   const wordStyle = useAnimatedStyle(() => ({
//     transform: [{ translateX: wordShiftX.value }],
//   }));
//   const dimStyle = useAnimatedStyle(() => ({ opacity: dimOpacity.value }));
//   const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayFade.value }));

//   return (
//     <Animated.View style={[styles.overlay, { backgroundColor }, overlayStyle]}>
//       <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />

//       <Animated.View style={[styles.brand, brandStyle]}>
//         <Animated.Image
//           source={LOGO}
//           style={[styles.logo, logoStyle]}
//           resizeMode="contain"
//         />

//         {wordW > 0 && (
//           <Animated.View style={[styles.wordSlot, { width: wordW }]}>
//             <Animated.Text style={[styles.word, wordStyle]} numberOfLines={1}>
//               milgo
//             </Animated.Text>
//           </Animated.View>
//         )}
//       </Animated.View>

//       {/* invisible twin used once to measure the wordmark's natural width */}
//       <Animated.Text
//         style={[styles.word, styles.measure]}
//         onLayout={(e) => setWordW(e.nativeEvent.layout.width)}
//       >
//         milgo
//       </Animated.Text>
//     </Animated.View>
//   );
// }

// const styles = StyleSheet.create({
//   overlay: {
//     position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
//     alignItems: 'center',
//     justifyContent: 'center',
//     zIndex: 999,
//   },
//   dim: { backgroundColor: '#009A43' },
//   brand: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     position: 'relative',
//   },
//   logo: {
//     width: LOGO_W,
//     height: LOGO_H,
//     zIndex: 2,
//   },
//   wordSlot: {
//     position: 'absolute',
//     left: LOGO_W - OVERLAP, // tucks behind the logo for a tight "Emilgo" read
//     top: 0,
//     bottom: 0,
//     justifyContent: 'center',
//     overflow: 'hidden',
//     zIndex: 1,
//   },
//   word: {
//     fontSize: 25,
//     fontWeight: '800', // pair with Montserrat-ExtraBold via expo-font
//     color: '#fff',
//     letterSpacing: 0.5,
//     includeFontPadding: false,
//   },
//   measure: { position: 'absolute', opacity: 0, left: -9999, top: 10 },
// });



























/**
 * EmilgoSplash.tsx — Animated splashscreen overlay for the Emilgo app (Expo / React Native)
 *
 * TIMELINE (FAST ≈ 3.0 s):
 *   0.0–0.25s  logo pops in, centred
 *   0.25–0.90s logo nudges left, "milgo" slides out from behind it (whole text)
 *   0.90–2.10s hold
 *   2.10–2.65s wordmark slides back behind logo, logo returns centre
 *   2.65–2.77s quick shrink anticipation (Twitter-style dip)
 *   2.77–3.05s exponential zoom-through → app
 */

import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSettingsStore } from "@/src/store/useSettingsStore";
import { Colors } from "@/constants/colors";


const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ---- Brand assets -------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO = require('../assets/images/emilgo_logo_white.png');

const LOGO_H = 90;
const LOGO_W = LOGO_H * (540 / 871); // ≈ 56
const COVER = Math.max(SCREEN_W / LOGO_W, SCREEN_H / LOGO_H) * 1.35;

// How many pixels the wordmark tucks behind the logo (tight spacing)
const OVERLAP = 0;

// ---- Timing -------------------------------------------------------------------
const TIMING = {
  SPEC: { in: 300, reveal: 900, hold: 3000, retract: 1000, shrink: 150, zoom: 900 },
  FAST: { in: 1200, reveal: 650, hold: 1100, retract: 550, shrink: 450,  zoom: 300 },
} as const;
const T = TIMING.FAST;


const t0 = T.in;               // reveal starts
const t1 = t0 + T.reveal;      // reveal done → hold starts
const t2 = t1 + T.hold;        // retract starts
const t3 = t2 + T.retract;     // retract done → shrink starts
const t4 = t3 + T.shrink;      // zoom-through starts

const INOUT = Easing.inOut(Easing.cubic);

interface Props {
  onFinish?: () => void;
  backgroundColor?: string; // must match app.json splash.backgroundColor
}
// backgroundColor = '#000000'
export default function EmilgoSplash({ onFinish, backgroundColor  }: Props) {

  const { theme } = useSettingsStore();
  const isDark = theme === "dark";
  const bg = isDark ? Colors.background : Colors.textWhite;

  const [wordW, setWordW] = useState(0);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const logoOpacity = useSharedValue(0);
  const brandScale  = useSharedValue(0.92);
  // FIX: start far off-screen so the wordmark is never visible before the logo
  const wordShiftX  = useSharedValue(-9999);
  const brandShiftX = useSharedValue(0);
  const dimOpacity  = useSharedValue(0);
  const overlayFade = useSharedValue(1);

  useEffect(() => {
    if (wordW === 0) return;

    // Offset that keeps the combined logo+wordmark centred on screen
    const centreOffset = -(wordW - OVERLAP) / 2;

    // 1a — logo settles in
    logoOpacity.value = withTiming(1, { duration: T.in, easing: Easing.out(Easing.cubic) });

    // Scale choreography: pop-in → hold → shrink anticipation → zoom-through
    brandScale.value = withSequence(
      withTiming(1, { duration: T.in, easing: Easing.out(Easing.cubic) }),
      withDelay(t3 - T.in, withTiming(0.88, { duration: T.shrink, easing: Easing.out(Easing.cubic) })),
      withTiming(COVER, { duration: T.zoom, easing: Easing.in(Easing.exp) })
    );

    // Wordmark slides out from behind the logo as one solid unit
    wordShiftX.value = -wordW;
    wordShiftX.value = withSequence(
      withDelay(t0, withTiming(0, { duration: T.reveal, easing: INOUT })),
      withDelay(T.hold, withTiming(-wordW, { duration: T.retract, easing: INOUT }))
    );

    // Nudge the whole brand so the full "Emilgo" mark stays centred while the word appears
    brandShiftX.value = withSequence(
      withDelay(t0, withTiming(centreOffset, { duration: T.reveal, easing: INOUT })),
      withDelay(T.hold, withTiming(0, { duration: T.retract, easing: INOUT }))
    );

    // Background dims during the shrink beat
    dimOpacity.value = withDelay(t3, withTiming(0.35, { duration: T.shrink }));

    // Splash dissolves into the app
    overlayFade.value = withDelay(
      t4 + T.zoom * 0.8,
      withTiming(0, { duration: T.zoom * 0.5 }, (finished) => {
        if (finished && onFinishRef.current) runOnJS(onFinishRef.current)();
      })
    );
  }, [wordW]);

  const logoStyle = useAnimatedStyle(() => ({ opacity: logoOpacity.value }));
  const brandStyle = useAnimatedStyle(() => ({
    transform: [{ scale: brandScale.value }, { translateX: brandShiftX.value }],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wordShiftX.value }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dimOpacity.value }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayFade.value }));

  return (
    <Animated.View style={[styles.overlay, { backgroundColor: bg }, overlayStyle]}>
      {/* <StatusBar hidden /> */}

      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />

      <Animated.View style={[styles.brand, brandStyle]}>
        <Animated.Image
          source={LOGO}
          style={[styles.logo, logoStyle]}
          resizeMode="contain"
        />

        {wordW > 0 && (
          <Animated.View style={[styles.wordSlot, { width: wordW }]}>
            <Animated.Text style={[styles.word, wordStyle]} numberOfLines={1}>
              milgo
            </Animated.Text>
          </Animated.View>
        )}
      </Animated.View>

      {/* invisible twin used once to measure the wordmark's natural width */}
      <Animated.Text
        style={[styles.word, styles.measure]}
        onLayout={(e) => setWordW(e.nativeEvent.layout.width)}
      >
        milgo
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  dim: { backgroundColor: '#000' },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  logo: {
    width: LOGO_W,
    height: LOGO_H,
    zIndex: 2,
  },
  wordSlot: {
    position: 'absolute',
    left: LOGO_W - OVERLAP, // tucks behind the logo for a tight "Emilgo" read
    top: -3,
    bottom: 0,
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 1,
  },
  word: {
    fontSize: 25,
    fontWeight: '800', // pair with Montserrat-ExtraBold via expo-font
    color: '#fff',
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
  measure: { position: 'absolute', opacity: 0, left: -9999, top: 0 },
});



