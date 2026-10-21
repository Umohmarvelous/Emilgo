// Language (SPEC-V2 §7.5 #16): English and Nigerian Pidgin, like the EMILGO app.
//
// The game is written in English. In Pidgin, every screen is translated as it
// is drawn (translateTree, from Screens.mount), and lines set from code go
// through t(). A string with no Pidgin yet stays English: never a blank.
// Players' names and chat are never touched (they are not in the table).

import type { Lang } from "../settings";

let lang: Lang = "en";

export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l === "pcm" ? "pcm" : "en";
}

export function getLang(): Lang {
  return lang;
}

/** One line in the player's language. */
export function t(en: string): string {
  if (lang === "en") return en;
  const exact = PCM[en];
  if (exact) return exact;
  for (const [re, to] of PATTERNS) if (re.test(en)) return en.replace(re, to);
  return en;
}

const ATTRS = ["aria-label", "placeholder", "title"] as const;

/** What each translated text was in English, and what we put there (code may change it after). */
const seen = new WeakMap<object, { en: string; shown: string }>();
const seenAttr = new WeakMap<Element, Map<string, { en: string; shown: string }>>();

/**
 * Put every text node and label under `root` in the current language: a
 * screen just drawn, or the whole UI after the language changes (English
 * comes back from what was remembered).
 */
export function translateTree(root: Element): void {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const now = n.nodeValue ?? "";
    let rec = seen.get(n);
    if (!rec || rec.shown !== now) {
      if (lang === "en" && !rec) continue;
      rec = { en: now, shown: now };
    }
    const s = rec.en.trim();
    if (!s || !/[A-Za-z]/.test(s)) continue;
    const to = rec.en.replace(s, t(s));
    if (to !== now) n.nodeValue = to;
    rec.shown = to;
    seen.set(n, rec);
  }
  for (const a of ATTRS) {
    const list = root.matches(`[${a}]`) ? [root, ...Array.from(root.querySelectorAll(`[${a}]`))] : Array.from(root.querySelectorAll(`[${a}]`));
    for (const el of list) {
      const now = el.getAttribute(a)!;
      let m = seenAttr.get(el);
      let rec = m?.get(a);
      if (!rec || rec.shown !== now) {
        if (lang === "en" && !rec) continue;
        rec = { en: now, shown: now };
      }
      const to = t(rec.en);
      if (to !== now) el.setAttribute(a, to);
      rec.shown = to;
      if (!m) seenAttr.set(el, (m = new Map()));
      m.set(a, rec);
    }
  }
}

/** Lines with numbers or names in them. */
const PATTERNS: [RegExp, string][] = [
  [/^Starting in (\d+)s, or when everyone's ready$/, "E go start for $1s, or when everybody ready"],
  [/^Starting in (\d+)s…$/, "E go start for $1s…"],
  [/^Starting in (\d+)s · (\d+) still on the way…$/, "E go start for $1s · $2 still dey come…"],
  [/^Returning to lobby in$/, "We dey go back lobby for"],
  [/^(\d+) players$/, "$1 people"],
  [/^(\d+) \/ (\d+) in$/, "$1 / $2 dey inside"],
  [/^Safe · (\d+)$/, "Safe · $1"],
  [/^(\d+) rounds? left$/, "$1 round remain"],
  [/^Boosts on: (.+)$/, "Boost don on: $1"],
  [/^(.+) invites you to a room$/, "$1 dey call you join im room"],
  [/^(.+) wants to be friends$/, "$1 wan be your padi"],
  [/^Removed (.+)$/, "$1 don comot for your list"],
  [/^(.+): (\d+) rounds$/, "$1: $2 rounds"],
  [/^Code (.+) copied$/, "Code $1 don copy"],
  [/^Graphics: (.+), to keep the game smooth on this phone$/, "Graphics: $1, make the game no hang for this phone"],
  [/^Played (.+)$/, "Una play $1"],
  [/^(\d+)(st|nd|rd|th) across$/, "$1$2 to cross"],
  [/^Switch on up to (\d+)\. (.+)$/, "You fit on reach $1. Each one wey you on go use one round when round start, for Solo and free match. Boost no dey work for Lagos Life staked match at all, and e no cost money: na CP only."],
];

const PCM: Record<string, string> = {
  // Lobby and tabs
  Lobby: "Lobby",
  Loadout: "Loadout",
  Store: "Shop",
  Friends: "Padi dem",
  Clan: "Clan",
  Leaderboard: "Leaderboard",
  Soon: "E dey come",
  Play: "Play",
  Customize: "Fine-tune",
  Emotes: "Emotes",
  Invite: "Call person",
  Online: "Online",
  "In match": "Dey match",
  "In a match": "Dey match",
  "In a room": "Dey room",
  "In the lobby": "Dey lobby",
  Offline: "No dey online",
  "Daily · resets at midnight": "Today own · e go reset for midnight",
  "Your profile": "Your profile",
  "Change mode and map": "Change mode and map",
  "Boosts · outfits · emotes": "Boost · cloth · emotes",
  "Boosts · try the looks": "Boost · try the cloth",
  Tutorial: "How to play",
  Settings: "Settings",
  "Close game": "Close game",
  // Play
  "Invite Friends": "Call your padi dem",
  "Play with New People": "Play with new people",
  "Play Solo vs AI": "Play alone with CPU",
  "Lagos Life match": "Lagos Life match",
  "Make a room and share its code, or join one": "Make room, share the code, or join one",
  Practice: "Practice",
  Stakes: "Stake",
  "You're offline": "You no dey online",
  "You're offline right now.": "You no dey online now.",
  "Coming soon in this build": "E dey come for this version",
  "Connecting…": "E dey connect…",
  Mode: "Mode",
  Distance: "Distance",
  Sky: "Sky",
  Start: "Start",
  "Make a room": "Make room",
  Join: "Join",
  Switch: "Change",
  "Online rounds pick a map for the room.": "Online round go pick map for the room.",
  "Reach the line. Survive.": "Reach the line. Survive.",
  "Grab a ball and carry it over the line. Fewer balls than players.": "Carry ball cross the line. Ball no reach everybody.",
  Maps: "Maps",
  // Settings
  Graphics: "Graphics",
  Audio: "Sound",
  Controls: "Controls",
  Game: "Game",
  Account: "Account",
  Quality: "Quality",
  Auto: "Auto",
  Low: "Low",
  Med: "Med",
  Medium: "Medium",
  High: "High",
  Map: "Map",
  Light: "Light",
  Dark: "Dark",
  "Light / dark mode": "Light / dark mode",
  "Light: full daylight, street lights off. Dark: full night, street lights and neon on": "Light: full afternoon, street light off. Dark: full night, street light and neon on",
  "Rotate the game": "Turn the game",
  "Turns the game on its side, for landscape with rotation lock on": "E go turn the game for side, if your phone rotation lock dey on",
  "Data saver": "Save data",
  "Half the updates from the server online. Others look a touch less smooth": "Half the update from server when you dey online. Other people go move small rough",
  "Low: no shadows, 2D clouds, lightest on battery, 30 fps on menus. Medium: shadows, sharper people and textures. High: full shadows, volumetric clouds, real reflections in puddles, glow and colour grading. Auto picks for your phone and adjusts the sharpness as you play.":
    "Low: no shadow, flat cloud, e no dey chop battery, 30 fps for menu. Medium: shadow, people and ground clear well. High: full shadow, thick cloud, real reflection for water, glow and colour. Auto go choose for your phone and adjust am as you dey play.",
  "Master volume": "Main volume",
  Everything: "Everything",
  Music: "Music",
  "Her songs. Her warning hum still plays when off": "Her song dem. Her warning hum go still play if you off am",
  "Music volume": "Music volume",
  "Her songs": "Her song dem",
  "Sound effects": "Sound effects",
  "Sound effects volume": "Sound effects volume",
  "Lasers, hits, footsteps, the drum": "Laser, blow, footstep, the drum",
  Vibration: "Vibration",
  "Voice chat": "Voice chat",
  "Voice chat volume": "Voice chat volume",
  "Not available": "E no dey",
  "Not available: games in Lagos Life have no microphone. Use text chat and quick chat": "E no dey: games for Lagos Life no get microphone. Use text chat and quick chat",
  "Not available: no microphone in Lagos Life": "E no dey: Lagos Life no get microphone",
  "Camera sensitivity": "Camera speed",
  "Both look speeds together": "Both look speed together",
  "Horizontal sensitivity": "Side speed",
  "Looking sideways. Lower is calmer": "To look side. Low one calm pass",
  "Vertical sensitivity": "Up-down speed",
  "Looking up and down. Lower is calmer": "To look up and down. Low one calm pass",
  "Invert Y axis": "Flip up and down",
  "Push up to look down": "Push up make you look down",
  "Stick size": "Stick size",
  Small: "Small",
  Large: "Big",
  "Stick opacity": "How the stick show",
  "How solid the sticks look while you hold them": "How strong the stick go show when you hold am",
  "Left-handed": "Left hand",
  "Move on the right, look on the left": "Waka for right, look for left",
  Sprint: "Sprint",
  "Toggle: tap on, tap off. Hold: sprint while held. Auto: a full push sprints": "Toggle: tap on, tap off. Hold: sprint while you hold am. Auto: full push go sprint",
  Toggle: "Toggle",
  Hold: "Hold",
  "Look stick": "Look stick",
  "Always drawn, or only while touched": "E go always show, or only when you touch am",
  "On touch": "When you touch",
  Always: "Always",
  "Camera drifts back behind you": "Camera go return back your back",
  "Off: the camera stays where you leave it": "Off: camera go stay where you leave am",
  "Start in first person": "Start with your own eye",
  "Switch any time with the eye button": "Change am any time with the eye button",
  "All controls": "All the controls",
  "Also: WASD or the arrows to move, Q/E or a mouse drag to look, V for first person, Esc to pause.": "Also: WASD or arrow to waka, Q/E or drag mouse to look, V for your own eye, Esc to pause.",
  Language: "Language",
  "Menus, the HUD and the tutorial": "Menu, HUD and how to play",
  English: "English",
  Pidgin: "Pidgin",
  "Map size": "Map size",
  "The minimap. Tap it in a round for the full map": "The small map. Tap am for round to see the full map",
  Notifications: "Notification",
  "Invites and friend requests pop up in the lobby": "Invite and padi request go show for lobby",
  "Friend requests": "Padi request",
  "Off: nobody can send you one": "Off: nobody fit send you one",
  "Online chat": "Online chat",
  "Waiting rooms and results. Tap a message, or a name on the scoreboard, to mute, block or report": "Waiting room and result. Tap message, or name for scoreboard, to mute, block or report",
  "Kill feed": "Who don comot",
  "Who was eliminated, top centre": "Who don comot, for top middle",
  "Blood effects": "Blood",
  "Off shows dust instead": "Off go show dust instead",
  "Screen shake": "Screen shake",
  "Your name comes from the app you play in": "Your name na from the app wey you dey play inside",
  Level: "Level",
  "Earned by playing; kept on this device": "You earn am by playing; e dey this phone",
  CP: "CP",
  "Earned by playing; spent on boosts in the Store": "You earn am by playing; you fit use am buy boost for Shop",
  "Rounds played": "Round wey you play",
  "Lines crossed": "Line wey you cross",
  "Best score": "Best score",
  "Watch a round played, every rule explained": "Watch one round, every rule explain",
  "Reset to default": "Return am to how e be",
  "Every setting back to how it came. Your level, CP, boosts, friends and looks stay": "Every setting go back to how e come. Your level, CP, boost, padi and cloth go stay",
  Reset: "Reset",
  Cancel: "Cancel",
  "Settings reset": "Settings don reset",
  // Pause
  Paused: "Pause",
  Resume: "Continue",
  Restart: "Start again",
  "Quit match": "Comot for match",
  "Quit to lobby": "Go back lobby",
  "The round goes on online. You're standing still, and standing still is safe.": "Round still dey go online. You dey stand still, and to stand still dey safe.",
  // Store
  "Boosts · CP": "Boost · CP",
  Cosmetics: "Cloth and style",
  "Your CP": "Your CP",
  "Earned only by playing: every round, more for crossing, more for first.": "Na only playing dey give am: every round, more if you cross, more if you be first.",
  "None yet": "Nothing yet",
  On: "On",
  Off: "Off",
  Wear: "Wear am",
  Owned: "Na your own",
  Paying: "E dey pay",
  "Restore purchases": "Bring back wetin you buy",
  "Cosmetics only. Items are bought inside Lagos Life; here you can tap any item to try it on.": "Na only cloth and style. You go buy dem inside Lagos Life; here you fit tap any one try am on.",
  "Quick Feet": "Quick Leg",
  "Walk and run 4% faster.": "Waka and run 4% faster.",
  Sprinter: "Sprinter",
  "Sprint 4% faster.": "Sprint 4% faster.",
  "Second Wind": "Second Breath",
  "A full stamina bar lasts 25% longer.": "Full stamina go last 25% longer.",
  "Fast Breath": "Quick Breath",
  "Stamina refills 25% faster.": "Stamina go full back 25% faster.",
  "Cool Head": "Cool Head",
  "Freeze resistance: a tenth of a second more before her stare counts you.": "Freeze power: small time more before her eye count you.",
  "Iron Grip": "Iron Hand",
  "Ball grip: the first hit each round doesn't knock your ball loose.": "Hold ball well: the first blow for each round no go make your ball fall.",
  "Quick Hands": "Quick Hand",
  "Pick a ball up 40% faster.": "Carry ball 40% faster.",
  "Thick Skin": "Strong Body",
  "Stunned 30% shorter when hit.": "Blow go shake you 30% less time.",
  Rooted: "Stand Gidigba",
  "Knocked back 30% less.": "Blow go push you back 30% less.",
  "Long Arm": "Long Hand",
  "Your fist, slap and push reach 0.3 m further.": "Your fist, slap and push go reach 0.3 m further.",
  "Quick Fists": "Quick Fist",
  "Attack again 20% sooner.": "Attack again 20% quicker.",
  "Low Rider": "Low Waka",
  "Crouch and crawl 20% faster.": "Bend and crawl 20% faster.",
  "Ball Haunting.": "Ball Haunting.",
  Boosts: "Boost",
  "Lobby pose": "Lobby pose",
  "Edit the wheel": "Arrange the wheel",
  // Friends
  "Recent players": "People wey you play with",
  "Room code": "Room code",
  "Wants to be friends": "Wan be your padi",
  "Invites you to a room": "Dey call you join im room",
  Accept: "Accept",
  No: "No",
  Add: "Add",
  Friend: "Padi",
  "Add friend": "Add as padi",
  "No friends yet": "No padi yet",
  "Add people from Recent players, or tap a name in your room or on the scoreboard.": "Add people from people wey you play with, or tap name for your room or for scoreboard.",
  "No one yet": "Nobody yet",
  "People you play online with show up here.": "People wey you play with online go show here.",
  "Add someone while they're still online: they get a friend request. Players are known by display name only.": "Add person while e still dey online: e go get padi request. Na only display name we sabi players by.",
  "Invite friends who are on: they get a notification in the lobby.": "Call padi wey dey online: e go see am for lobby.",
  "Make a room (Room code) to invite friends who are on.": "Make room (Room code) to call padi wey dey online.",
  "Your room is open. Share this code, or invite a friend from the Friends tab.": "Your room don open. Share this code, or call padi from Padi tab.",
  "Copy code": "Copy code",
  "Go to room": "Go the room",
  "Room size": "Room size",
  "Friend request sent.": "Padi request don go.",
  "They're not online right now.": "E no dey online now.",
  "Make a room first, then invite.": "Make room first, then call am.",
  "Can't reach the game server.": "We no fit reach the game server.",
  // Room and match
  Ready: "Ready",
  "Not ready": "I never ready",
  Leave: "Comot",
  Loading: "E dey load",
  "Loading…": "E dey load…",
  "Here we go": "Oya, make we go",
  "Waiting for more players…": "We dey wait for more people…",
  "Waiting for everyone to be ready…": "We dey wait make everybody ready…",
  "Tap Ready. It starts when everyone's ready.": "Tap Ready. E go start when everybody ready.",
  "Share the code. It starts when everyone's ready.": "Share the code. E go start when everybody ready.",
  "A round is running. You'll join the next one.": "One round dey run. You go join the next one.",
  "Round over. Back in a moment…": "Round don finish. We dey come back now now…",
  "Waiting for everyone in the match…": "We dey wait for everybody for the match…",
  "Waiting…": "We dey wait…",
  "Stake each": "Each person stake",
  Free: "Free",
  "Kalo Kalo · just for fun": "Kalo Kalo · na just for fun",
  "Small Small": "Small Small",
  Serious: "Serious",
  "Big Boy": "Big Boy",
  Odogwu: "Odogwu",
  "Stakes are Lagos Life game money: not real money, never cashed out. You confirm on Lagos Life's own sheet.": "Stake na Lagos Life game money: no be real money, you no fit cash am out. You go confirm for Lagos Life own sheet.",
  "Share this code. The round starts when every seat is filled.": "Share this code. Round go start when every seat full.",
  "One moment": "Wait small",
  // Results
  "Winner's circle": "Winners' corner",
  Victory: "You win!",
  "Time up": "Time don finish",
  "No ball left": "Ball don finish",
  Eliminated: "You don comot",
  Place: "Position",
  Time: "Time",
  Score: "Score",
  Best: "Best",
  Crossed: "Cross",
  "Play again": "Play again",
  "Play again online": "Play again online",
  "Back to the room": "Back to the room",
  "Another match": "Another match",
  Watch: "Watch",
  "Sending the result to Lagos Life…": "We dey send result give Lagos Life…",
  // HUD and play
  Skip: "Skip",
  "Next runner": "Next runner",
  Results: "Result",
  "Kill cam": "Kill cam",
  "Play of the game": "Best play for the game",
  "Closest escape": "Close escape",
  "Best dodge": "Best dodge",
  "Best attack": "Best attack",
  Scoreboard: "Scoreboard",
  Players: "Players",
  "Tap a name: mute, block, report": "Tap name: mute, block, report",
  In: "Dey",
  Safe: "Safe",
  Out: "Comot",
  "Connection lost": "Connection don cut",
  "Reconnecting…": "E dey connect back…",
  "Reconnecting… you're standing still": "E dey connect back… you dey stand still",
  "Tap to rotate": "Tap make e turn",
  // Chat and moderation
  Chat: "Chat",
  "Be nice. Never share numbers or links.": "Talk well. No share number or link.",
  "Say something…": "Talk something…",
  Send: "Send",
  "Mute (only you stop seeing them)": "Mute (na only you no go see am again)",
  Unmute: "Unmute",
  Block: "Block",
  "Report for:": "Report am for:",
  "Insults or harassment": "Curse or wahala",
  "Scam or asking for money": "419 or begging for money",
  Cheating: "Cheating",
  "Offensive name": "Bad name",
  "Wait!": "Wait!",
  "Watch out!": "Shine your eye!",
  "Help!": "Help!",
  "Nice one!": "Correct!",
  "Sorry!": "Sorry!",
  "Go!": "Go!",
  // Tutorial
  "Got it": "I don understand",
  "Close tutorial": "Close how to play",
  "Mama sings: run": "Mama dey sing: run",
  "She hums: get ready": "She dey hum: get ready",
  "She turns: freeze": "She turn: stand still",
  "Move and you're out": "Move and you don comot",
  "Cross the line": "Cross the line",
  "Grab a ball": "Carry ball",
  "Fight for the balls": "Fight for the ball dem",
  "That's the game": "Na so the game be",
  "When Mama sings, run. A small push on the stick walks, a full push runs. Sprint while your stamina lasts.": "When Mama dey sing, run. Small push for stick na waka, full push na run. Sprint while your stamina still dey.",
  "Before she turns, she hums for three seconds. Get ready to stop. Sometimes it's a trick, and she sings on.": "Before she turn, she go hum for three seconds. Get ready to stop. Sometimes na trick, she go continue to sing.",
  "She turns round. Let go of the stick and stand still. Ada stops at once.": "She don turn. Leave the stick and stand still. Ada stop one time.",
  "Tunde kept running while she looked. Anyone moving is out. Jumping or crouching counts as moving.": "Tunde still dey run when she dey look. Anybody wey move don comot. To jump or bend na move too.",
  "Reach the line before the time runs out. Walking all the way won't make it.": "Reach the line before time finish. If you waka slow slow, you no go reach.",
  "Carry your ball over the line. It drops in a basket and you are safe.": "Carry your ball cross the line. E go fall for basket and you don safe.",
  "Fist, slap or push someone close to knock their ball loose. Never while she's looking: the attacker is shot.": "Fist, slap or push person wey dey near make im ball fall. No do am when she dey look: na the person wey attack dem go shoot.",
  "That's the game. Watch Mama, not the beat. Good luck!": "Na so the game be. Watch Mama, no be the beat. Good luck!",
  // Errors and notes
  "Not today": "No be today",
  "Try again": "Try again",
  "Update the game to play online.": "Update the game make you fit play online.",
  "That room is full.": "That room don full.",
  "No room with that code. Check it and try again.": "No room get that code. Check am again.",
  "Can't reach the game server. Check your connection and try again.": "We no fit reach the game server. Check your network and try again.",
  "Your connection dropped for too long, so you lost your place.": "Your network cut for too long, so you don lose your place.",
  "Lost the connection to the game server.": "Connection to the game server don cut.",
};
