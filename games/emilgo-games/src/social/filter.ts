// Chat moderation. The SERVER runs this on every message before anyone sees
// it; the client runs it too, only so your own message looks the same as it
// will to everyone else.
//
// Two jobs:
//   1. Strong insults and slurs — English, Nigerian Pidgin, Yoruba, Igbo and
//      Hausa — become ★★★. Matching survives the usual dodges: c4ps, l33t,
//      s p a c e d, doubled leeetters.
//   2. Contact and payment details are removed outright: links, emails, phone
//      numbers, account numbers and "@handles". In a game with stakes, "send me
//      your account number" is a scam; and Lagos Life forbids collecting
//      personal data or pointing players to pay anywhere else (Developer
//      Agreement §4(g), §8).
//
// Friendly banter stays: "mumu", "olodo", "wawa" are how half of Lagos says
// hello. The list targets what hurts, not what's cheeky.

const MAX_LEN = 120;

/**
 * Kept short on purpose: every word here was checked for an innocent meaning.
 * Left OUT because they also mean something harmless — òdodo (truth, Yoruba),
 * oko (husband / farm), otu (one, Igbo), Omole (a Lagos estate), "your mother".
 */
const BLOCKED = [
  // English
  "fuck", "fuk", "fck", "shit", "bitch", "bastard", "cunt", "dick", "pussy", "whore", "slut", "nigger", "nigga",
  "faggot", "fag", "retard", "rape", "rapist", "motherfucker", "asshole", "wanker", "twat", "prick", "dickhead",
  "killyourself", "kys",
  // Nigerian Pidgin
  "ashawo", "ashewo", "olosho", "toto",
  // Yoruba
  "oloshi", "omoale", "obo",
  // Igbo
  "nwaashi", "nwaanshi", "ikebe",
  // Hausa
  "danjaka", "daniska", "shege", "kuturu", "karuwa", "gindi",
  // Ethnic and religious slurs
  "nyamiri", "gambari", "kafiri",
];

/** Words that only count when they ARE the word ("rape" is inside "grape", "obo" inside "oboe"). */
const WHOLE_ONLY = new Set(["obo", "toto", "fag", "kys", "dick", "gindi", "prick", "rape", "ikebe", "fuk", "fck", "shit", "twat", "slut", "cunt"]);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
}

const PATTERNS = BLOCKED.map(norm);

// ── Contact & payment details ────────────────────────────────────────────────

const CONTACT: [RegExp, string][] = [
  [/\b(?:https?:\/\/|www\.)\S+/gi, "[link removed]"],
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[email removed]"],
  [/\b[\w-]+\.(?:com|ng|net|org|io|app|me|co|xyz|link|ly|gg|tv|info|biz)(?:\/\S*)?\b/gi, "[link removed]"],
  // 7+ digits, allowing spaces/dashes/dots between (phones, NUBAN account numbers, cards).
  [/\+?(?:\d[\s.-]?){6,}\d/g, "[number removed]"],
  [/(?:^|\s)@[a-z0-9_.]{2,}/gi, " [handle removed]"],
];

export interface Filtered {
  text: string;
  /** Something was hidden — the sender sees a gentle note. */
  changed: boolean;
}

/** Clean a chat message. Empty result = don't send it. */
export function filterChat(raw: string): Filtered {
  let text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LEN);
  let changed = false;

  for (const [re, label] of CONTACT) {
    const next = text.replace(re, label);
    if (next !== text) changed = true;
    text = next;
  }

  // Word by word ("fuuuck", "sh1t"), then neighbouring words spelled out
  // ("f u c k", "omo ale") — but a run of words must BE the word exactly, so
  // "is hit" never reads as anything.
  const words = text.split(" ");
  const hide = new Array(words.length).fill(false);
  for (let i = 0; i < words.length; i++) {
    for (let span = 1; span <= 5 && i + span <= words.length; span++) {
      const joined = norm(words.slice(i, i + span).join(""));
      if (!joined) continue;
      const hit = PATTERNS.some((p, k) =>
        span > 1 || WHOLE_ONLY.has(BLOCKED[k]) || p.length <= 3 ? joined === p : joined.includes(p),
      );
      if (hit) {
        for (let j = i; j < i + span; j++) hide[j] = true;
        break;
      }
    }
  }
  if (hide.some(Boolean)) {
    changed = true;
    text = words.map((w, i) => (hide[i] ? "★".repeat(Math.min(5, Math.max(3, w.length))) : w)).join(" ");
  }
  return { text: text.trim(), changed };
}

export const CHAT_MAX = MAX_LEN;
