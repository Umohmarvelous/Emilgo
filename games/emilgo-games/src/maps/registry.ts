// The 24 maps: what they are called, how they look by default, and a small
// drawn thumbnail for the map picker. The 3D for each lives in maps/recipes.
//
// Every map is the same game — a 120 m run to Mama's stage — dressed as a
// different place. Names are generic: no real business appears anywhere.

export type MapCategory = "ng-urban" | "ng-rural" | "intl-urban" | "intl-nature" | "special";
export type TimeOfDay = "sunrise" | "day" | "sunset" | "night";
/** SPEC-V2: the only falling weather is rain (no fog banks, snow, ash or storms). */
export type Weather = "clear" | "rain";
/** The five states a map can be played in (SPEC-V2 §6.2). */
export type SkyState = "sunny" | "rainy" | "sunrise" | "sunset" | "night";
export const SKY_STATES: readonly SkyState[] = ["sunny", "rainy", "sunrise", "sunset", "night"];
export const SKY_LABEL: Record<SkyState, string> = { sunny: "Sunny", rainy: "Rainy", sunrise: "Sunrise", sunset: "Sunset", night: "Night" };

/** A sky state as the world builds it: a time of day and whether it rains. */
export function skyParts(s: SkyState): { time: TimeOfDay; weather: Weather } {
  return s === "rainy" ? { time: "day", weather: "rain" } : s === "sunny" ? { time: "day", weather: "clear" } : { time: s, weather: "clear" };
}

/**
 * Light / dark mode (SPEC-V2 §6.4) over a chosen state: light is full daylight
 * (rain stays rain), dark is full night; auto keeps the state.
 */
export function withMode(s: SkyState, mode: "auto" | "light" | "dark"): SkyState {
  if (mode === "dark") return "night";
  if (mode === "light") return s === "rainy" ? "rainy" : "sunny";
  return s;
}

export interface MapInfo {
  id: string;
  name: string;
  category: MapCategory;
  blurb: string;
  /** The state this map is drawn for (its palette, its default). */
  sky: SkyState;
  time: TimeOfDay;
  weather: Weather;
  /** Thumbnail palette: sky top, horizon, ground, silhouette, accent. */
  colors: [string, string, string, string, string];
  shape: Silhouette;
  /** The field's half width, metres (default: the street's, config FIELD.halfWidth). */
  halfWidth?: number;
}

export const CATEGORIES: { id: MapCategory; label: string }[] = [
  { id: "ng-urban", label: "Naija City" },
  { id: "ng-rural", label: "Naija Village" },
  { id: "intl-urban", label: "World City" },
  { id: "intl-nature", label: "Wild" },
  { id: "special", label: "Spooky" },
];

type Silhouette =
  | "street" | "market" | "campus" | "beach" | "estate" | "park"
  | "village" | "farm" | "river" | "forest"
  | "ny" | "tokyo" | "london" | "dubai" | "paris" | "favela"
  | "dunes" | "snow" | "jungle" | "volcano"
  | "hospital" | "darkwood" | "mansion" | "bunker";

/** The maps were first drawn for day / golden hour / dusk / night: those become the five states. */
type DrawnFor = "day" | "golden" | "dusk" | "night";

const m = (
  id: string,
  name: string,
  category: MapCategory,
  shape: Silhouette,
  drawn: DrawnFor,
  weather: Weather,
  _weathers: Weather[],
  colors: MapInfo["colors"],
  blurb: string,
  extra: Partial<MapInfo> = {},
): MapInfo => {
  const sky: SkyState = drawn === "night" ? "night" : drawn === "day" ? (weather === "rain" ? "rainy" : "sunny") : "sunset";
  return { id, name, category, shape, sky, ...skyParts(sky), colors, blurb, ...extra };
};

export const MAPS: MapInfo[] = [
  // Nigerian urban
  m("lagos-street", "Lagos Street", "ng-urban", "street", "golden", "clear", ["clear", "rain"], ["#6aa6d8", "#f3c98b", "#7d7468", "#3a2c24", "#ffd700"], "The classic: shopfronts, danfos and Mama Gele's stage."),
  m("market-square", "Market Square", "ng-urban", "market", "day", "clear", ["clear", "rain"], ["#7bb4e0", "#f1dfb0", "#9a8566", "#5a2f1f", "#e85d04"], "Stalls, umbrellas and wheelbarrows. Mind the tomatoes."),
  m("university-campus", "University Campus", "ng-urban", "campus", "day", "clear", ["clear", "rain"], ["#86bde6", "#e9efe0", "#6e8f52", "#2f3b2a", "#0e5a8a"], "Lecture halls, a big lawn and a faculty bus."),
  m("beach-road", "Beach Road", "ng-urban", "beach", "golden", "clear", ["clear", "rain"], ["#5aa0d4", "#ffd29a", "#e7cf9e", "#2b4a5a", "#1b998b"], "Sand, palms and the Atlantic. The tide is not on your side."),
  m("estate-close", "Estate Close", "ng-urban", "estate", "dusk", "clear", ["clear", "rain"], ["#5b6f9a", "#f2a971", "#8a8478", "#2a2a33", "#f6f1e1"], "Duplexes, gates and a security post that sees everything."),
  m("motor-park", "Motor Park", "ng-urban", "park", "day", "clear", ["clear", "rain"], ["#7fb0d6", "#efd6a2", "#8b6b4a", "#3a2b1d", "#ffc400"], "Rows of danfos under rusty zinc. Owa! Owa!"),
  // Nigerian rural
  m("village-square", "Village Square", "ng-rural", "village", "golden", "clear", ["clear", "rain"], ["#79b2df", "#f6c27e", "#a2794e", "#3b2a1a", "#d7263d"], "Mud houses, thatch and the big baobab where elders sit."),
  m("farmland", "Farmland", "ng-rural", "farm", "day", "clear", ["clear", "rain"], ["#8cc3ea", "#eef0d0", "#6b8e3a", "#2c3a1a", "#f2a71b"], "Yam ridges and maize rows. Freeze like a scarecrow."),
  m("riverside", "Riverside", "ng-rural", "river", "dusk", "clear", ["clear", "rain"], ["#6b86b0", "#f0b48a", "#5b7a4a", "#1f2b22", "#2a9d8f"], "Canoes, nets and a slow brown river."),
  m("forest-path", "Forest Path", "ng-rural", "forest", "day", "clear", ["clear", "rain"], ["#7aa98a", "#cfe3c4", "#4a6a35", "#1c2b16", "#8bd400"], "Iroko and palms close in. Light falls in shafts."),
  // International urban
  m("new-york", "New York Street", "intl-urban", "ny", "dusk", "clear", ["clear", "rain"], ["#4b5f8a", "#f09a6a", "#4d4d52", "#1a1c22", "#ffc400"], "Brownstones, fire escapes and yellow cabs."),
  m("tokyo-alley", "Tokyo Alley", "intl-urban", "tokyo", "night", "rain", ["clear", "rain"], ["#1b1f3a", "#5b3a7a", "#2b2b33", "#0b0c12", "#ff4d8d"], "Lanterns, neon and a narrow wet lane."),
  m("london-square", "London Square", "intl-urban", "london", "day", "clear", ["clear", "rain"], ["#9aa7b5", "#d9dde0", "#7a7d80", "#2a2d33", "#c62828"], "Brick terraces and a red bus."),
  m("dubai-mall", "Dubai Mall", "intl-urban", "dubai", "day", "clear", ["clear", "rain"], ["#a7d3f2", "#f4ecd8", "#d9d2c3", "#5a6b7a", "#00a3a3"], "Polished floors and glass towers. Shiny shoes only."),
  m("paris-cafe", "Paris Café", "intl-urban", "paris", "golden", "clear", ["clear", "rain"], ["#87a9d6", "#f6d5a8", "#9b8f80", "#3a3530", "#8a1f2b"], "Cream façades, café tables and a long boulevard."),
  m("rio-favela", "Rio Favela", "intl-urban", "favela", "golden", "clear", ["clear", "rain"], ["#5ea3db", "#fbd38a", "#a07a5a", "#4a2a2a", "#2b9348"], "Painted houses stacked up the hill."),
  // International nature
  m("desert-field", "Desert Field", "intl-nature", "dunes", "day", "clear", ["clear", "rain"], ["#6fa9dc", "#f4dcae", "#dcb27a", "#9a6a3a", "#f2a71b"], "A wide open field of sand, far from anywhere. Mama waits at the end.", { halfWidth: 16 }),
  m("snowy-mountains", "Snowy Mountains", "intl-nature", "snow", "day", "clear", ["clear", "rain"], ["#9cc4e8", "#eef4fa", "#e9eef3", "#5b6b80", "#35b8ff"], "Pines and deep snow."),
  m("tropical-jungle", "Tropical Jungle", "intl-nature", "jungle", "day", "rain", ["clear", "rain"], ["#5f9a7a", "#cfe8b8", "#3f6a2a", "#14240e", "#ffd60a"], "Giant leaves, vines and a lot of noise."),
  m("volcanic-island", "Volcanic Island", "intl-nature", "volcano", "dusk", "clear", ["clear", "rain"], ["#3a2a3a", "#e06a3a", "#3a302c", "#120c0c", "#ff5a1f"], "Black rock and the glow of lava."),
  // Special / horror
  m("abandoned-hospital", "Abandoned Hospital", "special", "hospital", "night", "clear", ["clear", "rain"], ["#1f2a2a", "#4a5a52", "#3a3d3a", "#0b0f0e", "#9bd17a"], "Dim corridors and empty beds. Something is watching."),
  m("dark-forest", "Dark Forest", "special", "darkwood", "night", "clear", ["clear", "rain"], ["#0e1622", "#2b3a4a", "#1c2418", "#05080a", "#7ab8ff"], "Twisted trees and eyes in the dark."),
  m("haunted-mansion", "Haunted Mansion", "special", "mansion", "night", "rain", ["clear", "rain"], ["#1a1626", "#4a3a5a", "#2a2630", "#0a080e", "#c9a227"], "A long drive to a house nobody leaves."),
  m("underground-bunker", "Underground Bunker", "special", "bunker", "night", "clear", ["clear", "rain"], ["#1a1d22", "#3a3f46", "#4a4d52", "#121418", "#f5c400"], "Concrete, caged lamps and a blast door at the end."),
];

export const MAP_BY_ID: Record<string, MapInfo> = Object.fromEntries(MAPS.map((x) => [x.id, x]));
export const DEFAULT_MAP = "desert-field";

export function mapOf(id: string | undefined): MapInfo {
  return (id && MAP_BY_ID[id]) || MAP_BY_ID[DEFAULT_MAP];
}

// ── Thumbnails: a few shapes per place, in the map's own colours ─────────────

const SHAPES: Record<Silhouette, string> = {
  street: `<path d="M0 40V22h10v-6h8v6h6V12h12v10h8v-4h10v4h6V16h12v24z"/><path d="M38 40l6-18h12l6 18z" opacity=".35"/>`,
  market: `<path d="M0 40V30l8-6 8 6 8-6 8 6 8-6 8 6 8-6 8 6 8-6 8 6v10z"/><path d="M6 30v10M22 30v10M38 30v10M54 30v10M70 30v10"/>`,
  campus: `<path d="M8 40V18h40v22zM12 18l16-8 16 8"/><path d="M56 40V26h20v14z"/><path d="M14 22h4v6h-4zM24 22h4v6h-4zM34 22h4v6h-4z" opacity=".4"/>`,
  beach: `<path d="M0 30c12-4 24 4 36 0s28-4 44 0v10H0z"/><path d="M60 30c0-10 2-18 6-22M66 8c-6 0-10 3-12 6M66 8c6 0 10 3 12 6M66 8c-2-4-6-6-10-6"/>`,
  estate: `<path d="M4 40V24l12-8 12 8v16zM32 40V20l14-9 14 9v20zM62 40V26l9-6 9 6v14z"/>`,
  park: `<path d="M0 22h80v4H0z"/><path d="M4 40V26M76 40V26"/><path d="M8 40v-8h14v8zM26 40v-8h14v8zM44 40v-8h14v8zM62 40v-8h12v8z" opacity=".85"/>`,
  village: `<path d="M6 40V28h16v12zM4 28l10-10 10 10zM40 40V30h14v10zM38 30l9-8 9 8z"/><path d="M66 40V24c0-4 4-6 4-10M70 14c-6 0-8 4-10 6M70 14c6 0 8 4 10 6"/>`,
  farm: `<path d="M0 40l80-6v6z"/><path d="M0 36l80-8M0 32l80-10" stroke-width="1.5" fill="none"/><path d="M60 40V20M56 24h8M60 20l-3-4h6z"/>`,
  river: `<path d="M0 30c20-3 30 3 50 0s20-2 30 0v10H0z" opacity=".55"/><path d="M14 30l10-3h16l-6 3z"/><path d="M0 26V14l8-4 6 4 8-6 6 6v12z"/>`,
  forest: `<path d="M6 40V22M4 22l2-12 2 12zM20 40V18l-6 6 6-14 6 14-6-6zM40 40V20l-8 8 8-18 8 18-8-8zM62 40V24l-5 5 5-12 5 12-5-5z"/>`,
  ny: `<path d="M0 40V14h12v26zM14 40V6h10v34zM26 40V18h12v22zM40 40V10h8v30zM50 40V20h14v20zM66 40V12h14v28z"/>`,
  tokyo: `<path d="M0 40V8h18v32zM62 40V6h18v34z"/><path d="M24 14h6v6h-6zM50 16h6v6h-6z"/><path d="M20 26h40" stroke-width="1" fill="none"/>`,
  london: `<path d="M0 40V20h16v20zM18 40V16h14v24zM48 40V18h14v22zM64 40V22h16v18z"/><path d="M36 40V6h6v34z"/><path d="M35 6h8l-4-4z"/>`,
  dubai: `<path d="M36 40V2l4-2 4 2v38z"/><path d="M8 40V18h10v22zM20 40V12h10v28zM52 40V14h10v26zM64 40V22h12v18z"/>`,
  paris: `<path d="M40 40l-8-22h4l4-14 4 14h4z"/><path d="M0 40V22h20v18zM60 40V22h20v18z"/>`,
  favela: `<path d="M0 40V30h10v-6h10v-6h10v-6h10v6h10v6h10v6h10v-6h10v16z"/>`,
  dunes: `<path d="M0 30c14-12 26-12 40 0 10-8 26-10 40-2v12H0z"/>`,
  snow: `<path d="M0 40l18-26 10 12 14-22 20 28 18-14v22z"/><path d="M14 20l4-6 4 6M40 10l2-4 4 6" opacity=".6"/>`,
  jungle: `<path d="M0 40c4-14 8-18 14-20-4 6-4 14-2 20zM20 40c6-20 14-24 20-26-6 8-8 18-6 26zM46 40c4-16 10-20 16-22-4 8-4 16-2 22zM66 40c4-12 8-16 14-18v18z"/>`,
  volcano: `<path d="M0 40l30-30h20l30 30z"/><path d="M34 10c2-4 8-6 12-2" fill="none"/>`,
  hospital: `<path d="M6 40V12h68v28z"/><path d="M36 18h8v4h4v8h-4v4h-8v-4h-4v-8h4z" opacity=".5"/><path d="M12 18h6v6h-6zM56 18h6v6h-6zM12 28h6v6h-6zM56 28h6v6h-6z" opacity=".35"/>`,
  darkwood: `<path d="M10 40V18l-6-6M10 22l6-8M30 40V12l-8-6M30 18l8-10M54 40V16l-6-8M54 20l8-8M72 40V22l-4-6" stroke-width="2.5" fill="none"/>`,
  mansion: `<path d="M10 40V18h60v22zM8 18l32-14 32 14z"/><path d="M36 40V28h8v12z" opacity=".5"/><path d="M18 22h6v6h-6zM56 22h6v6h-6z" opacity=".4"/>`,
  bunker: `<path d="M0 40V14c14-10 66-10 80 0v26z"/><path d="M30 40V22h20v18z" opacity=".5"/>`,
};

/** A small SVG painting of a map (sky, ground, silhouette). */
export function thumbSvg(info: MapInfo): string {
  const [top, horizon, ground, sil, accent] = info.colors;
  const id = `g${info.id.replace(/[^a-z]/g, "")}`;
  const night = info.sky === "night";
  return `<svg viewBox="0 0 80 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${horizon}"/></linearGradient></defs>
    <rect width="80" height="40" fill="url(#${id})"/>
    ${night ? `<circle cx="64" cy="8" r="3" fill="#f2f2f2" opacity=".85"/>` : `<circle cx="64" cy="10" r="4" fill="${accent}" opacity=".7"/>`}
    <rect y="32" width="80" height="8" fill="${ground}"/>
    <g fill="${sil}" stroke="${sil}" stroke-width=".6">${SHAPES[info.shape]}</g>
    <rect width="80" height="40" fill="url(#${id})" opacity=".08"/>
  </svg>`;
}
