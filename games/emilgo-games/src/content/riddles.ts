// Riddles of the Elders (SPEC-V3 §9 #9; Phase 6). Each riddle's answer is a
// place in Naija World (a landmark or a named area): go there and take the
// kola-nut token.
//
// Languages: Pidgin (pcm) is shown with an English line beneath. Yoruba (yo),
// Igbo (ig) and Hausa (ha) are DRAFTS, written without a fluent speaker; per
// the owner (SPEC-V3 Answers) they stay hidden until one reviews them: flip
// `reviewed` for that language only after a fluent speaker has checked it.
// Written for EMILGO; the sayings are our own, not quoted from anywhere.

export type RiddleLang = "en" | "pcm" | "yo" | "ig" | "ha";

export interface Riddle {
  id: string;
  /** The place it points at: a landmark or area id (maps/open/naija.ts). */
  answer: string;
  text: Partial<Record<RiddleLang, string>> & { en: string; pcm: string };
  /** Which drafts a fluent speaker has checked (unreviewed ones never show). */
  reviewed: Partial<Record<"yo" | "ig" | "ha", boolean>>;
}

export const RIDDLES: readonly Riddle[] = [
  {
    id: "buspark",
    answer: "buspark",
    text: {
      en: "Where yellow beetles sleep in rows and wake to the conductor's cry.",
      pcm: "Where yellow motor dey sleep for line, and conductor shout go wake dem.",
      yo: "Níbi tí àwọn ọkọ̀ àwọ̀ ìyeyè ti ń sùn ní ìlà, tí kọndọ́ktọ̀ ń jí wọn.",
    },
    reviewed: {},
  },
  {
    id: "market",
    answer: "market",
    text: {
      en: "A thousand voices haggle under umbrellas; tomatoes wear red to the meeting.",
      pcm: "Plenty voice dey price under umbrella; tomato wear red come the meeting.",
      ig: "Ebe olu puku na-azụ ahịa n'okpuru nche anwụ.",
    },
    reviewed: {},
  },
  {
    id: "suya",
    answer: "suya",
    text: {
      en: "Smoke that smells of pepper, sticks that hold meat over fire, where the road bends at night.",
      pcm: "Smoke wey get pepper smell, stick wey hold meat for fire, where road bend for night.",
      ha: "Hayaƙi mai ƙamshin barkono, da tsinke mai riƙe nama a wuta.",
    },
    reviewed: {},
  },
  {
    id: "watertower",
    answer: "watertower",
    text: {
      en: "I hold the rain up high so the taps below can drink. What am I?",
      pcm: "I carry water for up, make tap for down fit drink. Wetin I be?",
      yo: "Mo gbé omi sókè, kí ẹ̀rọ omi nísàlẹ̀ lè mu. Kí ni mí?",
    },
    reviewed: {},
  },
  {
    id: "church",
    answer: "church",
    text: {
      en: "On the first day of the week my bell calls, and the singing answers.",
      pcm: "For first day of the week my bell dey call, and the singing go answer.",
    },
    reviewed: {},
  },
  {
    id: "mosque",
    answer: "mosque",
    text: {
      en: "Five times a day my tower speaks without a mouth.",
      pcm: "Five times every day, my tower dey talk without mouth.",
      ha: "Sau biyar a rana hasumiyata tana magana ba tare da baki ba.",
    },
    reviewed: {},
  },
  {
    id: "school",
    answer: "school",
    text: {
      en: "Little feet in brown sandals, chalk on a black board, a bell at closing.",
      pcm: "Small leg wey wear brown sandal, chalk for black board, bell for closing time.",
    },
    reviewed: {},
  },
  {
    id: "bridge",
    answer: "bridge",
    text: {
      en: "I lie across the water so feet don't get wet.",
      pcm: "I lie down across the water make leg no wet.",
      ig: "Ana m edina n'ofe mmiri ka ụkwụ ghara ịgba mmiri.",
    },
    reviewed: {},
  },
  {
    id: "petrol",
    answer: "petrol",
    text: {
      en: "When the queue is long, everyone knows there is scarcity. Where do cars go to drink?",
      pcm: "When the line long, everybody know say scarcity don land. Where motor dey go drink?",
    },
    reviewed: {},
  },
  {
    id: "mast",
    answer: "mast",
    text: {
      en: "Tall and thin, I catch your voice and throw it to your mother in the village.",
      pcm: "I tall, I thin, I dey catch your voice throw am give your mama for village.",
    },
    reviewed: {},
  },
  {
    id: "mechanic",
    answer: "mechanic",
    text: {
      en: "Oil on every hand, spanners singing, and every sick car is welcome.",
      pcm: "Oil for every hand, spanner dey sing, and every sick motor welcome.",
      yo: "Epo ní gbogbo ọwọ́, sípánà ń kọrin, gbogbo ọkọ̀ tí ń ṣàìsàn kú àbọ̀.",
    },
    reviewed: {},
  },
  {
    id: "barber",
    answer: "barber",
    text: {
      en: "I take from your head and you pay me for it.",
      pcm: "I collect from your head, and you go still pay me.",
    },
    reviewed: {},
  },
  {
    id: "palmwine",
    answer: "palmwine",
    text: {
      en: "Sweet in the morning, strong by evening, poured from the tree's own calabash.",
      pcm: "E sweet for morning, e strong for evening, dem pour am from the tree own calabash.",
      ig: "Ọ na-atọ ụtọ n'ụtụtụ, ọ na-esi ike na mgbede.",
    },
    reviewed: {},
  },
  {
    id: "borehole",
    answer: "borehole",
    text: {
      en: "Deep in the ground I keep the cool water; jerrycans line up for me.",
      pcm: "Deep for ground I keep cold water; jerrycan dey line up for me.",
      ha: "A cikin ƙasa ina ajiye ruwan sanyi; jarkoki suna jera mini.",
    },
    reviewed: {},
  },
  {
    id: "farm",
    answer: "farm",
    text: {
      en: "My roots become garri and fufu. Where do I grow?",
      pcm: "My root dey turn garri and fufu. Where I dey grow?",
    },
    reviewed: {},
  },
  {
    id: "tailor",
    answer: "tailor",
    text: {
      en: "A needle and a pedal: owambe outfits are born here.",
      pcm: "Needle and pedal: na here owambe cloth dey born.",
    },
    reviewed: {},
  },
];

/** The places a riddle can answer, beside the Elders' Bench (it isn't one). */
export const ELDERS_BENCH = "baobab";

/** The languages a riddle can be shown in now: Pidgin, and any draft a fluent speaker has reviewed. */
export function shownLangs(r: Riddle, wanted: readonly string[]): ("pcm" | "yo" | "ig" | "ha")[] {
  const out: ("pcm" | "yo" | "ig" | "ha")[] = [];
  for (const l of wanted) {
    if (l === "pcm") out.push("pcm");
    else if ((l === "yo" || l === "ig" || l === "ha") && r.text[l] && r.reviewed[l]) out.push(l);
  }
  return out.length ? out : ["pcm"];
}
