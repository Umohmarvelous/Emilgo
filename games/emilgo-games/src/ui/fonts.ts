// Fonts: Montserrat (headers, buttons), Inter (body), JetBrains Mono (numbers).
// Self-hosted (Latin only, ~85 KB in all), loaded in the background: text shows
// at once in the system font and swaps when the files land. Nothing is fetched
// from a font CDN — the Lagos Life frame and the EMILGO WebView both work offline.

import interUrl from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import interMedUrl from "@fontsource/inter/files/inter-latin-500-normal.woff2?url";
import monoUrl from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?url";
import montUrl from "@fontsource/montserrat/files/montserrat-latin-700-normal.woff2?url";
import montXUrl from "@fontsource/montserrat/files/montserrat-latin-800-normal.woff2?url";

export function loadFonts(): void {
  if (typeof FontFace === "undefined") return;
  const faces: [string, string, string][] = [
    ["Montserrat", montUrl, "700"],
    ["Montserrat", montXUrl, "800"],
    ["Inter", interUrl, "400"],
    ["Inter", interMedUrl, "500"],
    ["JetBrains Mono", monoUrl, "500"],
  ];
  for (const [family, url, weight] of faces) {
    const f = new FontFace(family, `url(${url}) format("woff2")`, { weight, display: "swap" });
    f.load()
      .then((loaded) => document.fonts.add(loaded))
      .catch(() => {
        /* system font stays */
      });
  }
}
