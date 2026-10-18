// The icon set: line icons drawn on a 24-unit grid, stroked in currentColor so
// they take the text colour (white or black) and animate with CSS (ui/styles.css:
// .ico-spin, .ico-pulse, .ico-bob, .ico-pop). No emoji, no phone icons.

const P: Record<string, string> = {
  // Navigation & chrome
  gear: `<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/><circle cx="12" cy="12" r="6.6"/>`,
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
  back: `<path d="M15 5l-7 7 7 7"/>`,
  next: `<path d="M9 5l7 7-7 7"/>`,
  skip: `<path d="M5 6l7 6-7 6z"/><path d="M12 6l7 6-7 6z"/><path d="M20 5v14"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  lock: `<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>`,
  help: `<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.9v.3M12 17v.4"/>`,
  home: `<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>`,
  exit: `<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>`,
  copy: `<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/>`,
  share: `<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.8l6.6-4M8.7 13.2l6.6 4"/>`,
  swap: `<path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/>`,
  refresh: `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>`,
  pause: `<path d="M9 5.5v13M15 5.5v13"/>`,
  play: `<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>`,
  // Lobby
  user: `<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c.8-4 3.8-6.2 7.5-6.2s6.7 2.2 7.5 6.2"/>`,
  friends: `<circle cx="9" cy="8.5" r="3.3"/><path d="M2.8 19.5c.6-3.4 3-5.3 6.2-5.3s5.6 1.9 6.2 5.3"/><circle cx="17" cy="7.5" r="2.6"/><path d="M16.2 12.8c2.7 0 4.6 1.5 5.1 4.4"/>`,
  invite: `<circle cx="10" cy="8" r="3.6"/><path d="M3 20c.7-3.7 3.5-5.8 7-5.8 1.6 0 3 .4 4.2 1.2"/><path d="M18.5 13v7M15 16.5h7"/>`,
  store: `<path d="M5 8.5h14l-1 11.5H6z"/><path d="M8.8 8.5V7a3.2 3.2 0 0 1 6.4 0v1.5"/>`,
  loadout: `<path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="1.8" fill="currentColor"/><circle cx="15" cy="12" r="1.8" fill="currentColor"/><circle cx="8" cy="18" r="1.8" fill="currentColor"/>`,
  customize: `<path d="M8.5 3.5 4 6l1.5 4.5 2-1V20.5h9V9.5l2 1L20 6l-4.5-2.5c-.5 1.5-1.9 2.5-3.5 2.5s-3-1-3.5-2.5z"/>`,
  emote: `<path d="M12 2.8l2.4 4.9 5.3.8-3.8 3.7.9 5.3L12 15l-4.8 2.5.9-5.3-3.8-3.7 5.3-.8z"/>`,
  clan: `<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>`,
  trophy: `<path d="M7.5 4.5h9v4a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5c0 3 1.5 4.5 3.3 4.7M16.5 6h3c0 3-1.5 4.5-3.3 4.7"/><path d="M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z"/>`,
  map: `<path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>`,
  flag: `<path d="M5.5 21V4"/><path d="M5.5 4.5h12l-2.5 4 2.5 4h-12"/>`,
  timer: `<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/>`,
  people: `<circle cx="8" cy="9" r="2.8"/><circle cx="16" cy="9" r="2.8"/><path d="M3 19c.5-3 2.5-4.6 5-4.6s4.5 1.6 5 4.6M11 19c.5-3 2.5-4.6 5-4.6s4.5 1.6 5 4.6"/>`,
  star: `<path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.5l-5.2 2.8 1-5.8L3.5 9.4l5.9-.8z" fill="currentColor" stroke="none"/>`,
  crown: `<path d="M4 18h16l1-10-5 4-4-6-4 6-5-4z"/><path d="M5 21h14"/>`,
  medal: `<circle cx="12" cy="15" r="5.5"/><path d="M8.5 10.5 6 3h4l2 4.5L14 3h4l-2.5 7.5"/>`,
  // Fighting and the ball (SPEC-V2 §2.4: icons only)
  fist: `<path d="M7 10.5V8.2a1.6 1.6 0 0 1 3.2 0V10M10.2 9.5V7.4a1.6 1.6 0 0 1 3.2 0v2.4M13.4 9.8V8a1.6 1.6 0 0 1 3.2 0v2.6"/><path d="M16.6 10.5a1.6 1.6 0 0 1 3.2 0v2.8c0 4-2.6 6.7-6.6 6.7h-1.6c-3 0-5.4-2.1-5.6-5.2L5.8 12c-.1-1.2.8-2 1.9-1.8l2.8.5"/><path d="M10.5 13.8c1.4-.6 2.6-.6 3.6.2"/>`,
  slap: `<path d="M8 20.5c-2-1.6-3.3-4-3.3-6.6V9.4a1.4 1.4 0 0 1 2.8 0v3.1"/><path d="M7.5 12.5V4.9a1.4 1.4 0 0 1 2.8 0v6.6M10.3 11.2V3.8a1.4 1.4 0 0 1 2.8 0v7.4M13.1 11.4V4.9a1.4 1.4 0 0 1 2.8 0v7.6"/><path d="M15.9 12.4V7.4a1.4 1.4 0 0 1 2.8 0v6.3c0 3.9-2.7 6.8-6.7 6.8"/><path d="M20 3.5l1.5-1.5M20.8 7h2M2.5 4l1.4 1.4"/>`,
  push: `<path d="M3.5 12h5M3.5 8.5h3M3.5 15.5h3"/><path d="M10 6.5h4.8a1.6 1.6 0 0 1 0 3.2H13M13 9.7h3.6a1.6 1.6 0 0 1 0 3.2H14M14 12.9h2.4a1.6 1.6 0 0 1 0 3.2H13.4M13.4 16.1h1.4a1.6 1.6 0 0 1 0 3.2H11c-1.9 0-3-1.1-3-3V9.3c0-1.6 1-2.8 2-2.8"/><path d="M17.8 6.5h2.6a1.6 1.6 0 0 1 1.6 1.6v8"/>`,
  grab: `<circle cx="12" cy="7.5" r="4"/><path d="M8.6 5.6c1.4 1 5.4 1 6.8 0M8.2 8.8c1.6.9 6 .9 7.6 0"/><path d="M5 15.5c1.5-.6 2.6-.1 3.5 1l1.6 2V13a1.3 1.3 0 0 1 2.6 0v3.4M12.7 15.6V14a1.3 1.3 0 0 1 2.6 0v2M15.3 15.8a1.3 1.3 0 0 1 2.6 0v1.4c0 2.4-1.7 4.3-4.4 4.3h-1.6c-1.6 0-2.8-.7-3.6-1.9"/>`,
  ping: `<path d="M4 5.5h16v10H11l-4.5 4v-4H4z"/><path d="M12 8v3.6M12 13.4v.2"/>`,
  ball: `<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17"/><path d="M6 6c2.6 2 2.6 10 0 12M18 6c-2.6 2-2.6 10 0 12"/>`,
  bolt: `<path d="M13.5 2.5 5 13.5h6.5L10.5 21.5 19 10.5h-6.5z"/>`,
  target: `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
  chat: `<path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z"/>`,
  send: `<path d="M4 12 20 4l-5 16-3.5-6.5z"/><path d="M11.5 13.5 20 4"/>`,
  // Customisation
  body: `<circle cx="12" cy="5" r="2.4"/><path d="M8 21l1.2-8L7 9.5h10L14.8 13 16 21M12 13v8"/>`,
  skin: `<path d="M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z"/>`,
  hair: `<path d="M6 13c0-5 2.6-8.5 6-8.5S18 8 18 13"/><path d="M6 13c-.6 3.5 0 6.5 1.5 7.5M18 13c.6 3.5 0 6.5-1.5 7.5"/><path d="M8.5 9.5c2 1.2 5 1.2 7 0"/>`,
  outfit: `<path d="M8.5 3.5 4 6l1.5 4.5 2-1V20.5h9V9.5l2 1L20 6l-4.5-2.5c-.5 1.5-1.9 2.5-3.5 2.5s-3-1-3.5-2.5z"/>`,
  cap: `<path d="M4.5 15.5c0-5 3.3-8.5 7.5-8.5s7.5 3.5 7.5 8.5z"/><path d="M4.5 15.5h15"/><path d="M12 7c1.5 1.5 3.5 2 5.5 2"/>`,
  shades: `<path d="M3 9.5h18"/><path d="M4 9.5c0 3.4 1.4 5 3.8 5s3.2-2 3.2-5M13 9.5c0 3 .9 5 3.2 5s3.8-1.6 3.8-5"/>`,
  pose: `<circle cx="12" cy="4.5" r="2.2"/><path d="M12 7v7l-3 7M12 14l3 7M12 9l-4.5-2M12 9l3 3 2.5-3.5"/>`,
  wheel: `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6"/>`,
  // Settings
  sound: `<path d="M4.5 9.5h3.5l5-4v13l-5-4H4.5z"/><path d="M16 9a4.2 4.2 0 0 1 0 6M18.5 6.5a7.8 7.8 0 0 1 0 11"/>`,
  mute: `<path d="M4.5 9.5h3.5l5-4v13l-5-4H4.5z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>`,
  music: `<path d="M9 18.5V5.5l10-2v13"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>`,
  vibrate: `<rect x="8" y="5" width="8" height="14" rx="2"/><path d="M4.5 8.5v7M19.5 8.5v7M2 10.5v3M22 10.5v3"/>`,
  graphics: `<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5"/><path d="M8.5 20h7M12 16v4"/><path d="M7 12.5l3-3 2.5 2.5 2-2 2.5 2.5"/>`,
  controls: `<path d="M7.5 8h9a4.5 4.5 0 0 1 4.3 5.8l-1.2 4a2.3 2.3 0 0 1-4 .8L14 16h-4l-1.6 2.6a2.3 2.3 0 0 1-4-.8l-1.2-4A4.5 4.5 0 0 1 7.5 8z"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="16" cy="11.5" r=".9" fill="currentColor"/><circle cx="17.5" cy="13.5" r=".9" fill="currentColor"/>`,
  eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>`,
  account: `<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="11" r="2.3"/><path d="M5.8 16.2c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h3.5M14.5 13.5h3.5"/>`,
  game: `<path d="M12 3.5 20 8v8l-8 4.5L4 16V8z"/><path d="M12 12.5V20.5M12 12.5 20 8M12 12.5 4 8"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>`,
  moon: `<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>`,
  rain: `<path d="M7 15.5a4.5 4.5 0 0 1 .4-9 5.5 5.5 0 0 1 10.3 1.6 3.8 3.8 0 0 1-.7 7.4z"/><path d="M8 18.5l-1 2.5M12 18.5l-1 2.5M16 18.5l-1 2.5"/>`,
  fog: `<path d="M3.5 9h17M5.5 13h13M3.5 17h17"/>`,
  // In play
  jump: `<path d="M12 20V6M6.5 11.5 12 6l5.5 5.5"/><path d="M5 3.5h14"/>`,
  crouch: `<circle cx="13" cy="5.5" r="2.3"/><path d="M13 8.5l-2.5 5.5 5 1.5 1 5M10.5 14l-4 6M11.5 10.5l4 2"/>`,
  prone: `<circle cx="19" cy="13.5" r="2"/><path d="M2.5 17.5h14.5M5 17.5l4-3h6"/>`,
  sprint: `<circle cx="15.5" cy="4.5" r="2.2"/><path d="M9.5 21l2.5-6.5 3 2.5V21M12 14.5l1.5-5.5-4 1-2.5 3M13.5 9l3 3.5 3-.5"/>`,
  fpv: `<path d="M3 8.5V5.5a1 1 0 0 1 1-1h3M17 4.5h3a1 1 0 0 1 1 1v3M21 15.5v3a1 1 0 0 1-1 1h-3M7 19.5H4a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/>`,
  tpv: `<circle cx="12" cy="8" r="3"/><path d="M6.5 20c.6-3.8 2.8-6 5.5-6s4.9 2.2 5.5 6"/><path d="M3 3.5h4M3 3.5v4"/>`,
  signal: `<path d="M5 19v-3M9.5 19v-6M14 19v-9M18.5 19V6"/>`,
  // Emotes
  wave: `<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V5.5a1.5 1.5 0 0 1 3 0V13c0 4.5-2.5 7.5-6.5 7.5-2.5 0-4-1.5-5.5-4l-2-3.5a1.4 1.4 0 0 1 2.4-1.4L8 13"/>`,
  dance: `<circle cx="13" cy="4" r="2"/><path d="M13 6.5 11 13l3 3-1 5M11 13l-3.5 2.5-2 4M12 8.5l4.5-2 2-3M12 8.5l-4-1-2.5 2"/>`,
  laugh: `<circle cx="12" cy="12" r="9"/><path d="M7.5 10l2-1.5M16.5 10l-2-1.5"/><path d="M7.5 13.5h9a4.5 4.5 0 0 1-9 0z"/>`,
  cry: `<circle cx="12" cy="12" r="9"/><path d="M8 9.5h2M14 9.5h2M9 16.5a4 4 0 0 1 6 0"/><path d="M8.5 12.5v3"/>`,
  taunt: `<circle cx="12" cy="12" r="9"/><path d="M8 9.5l2 1-2 1M16 9.5l-2 1 2 1M8.5 15h7"/><path d="M12 15v2.5a1.5 1.5 0 0 0 3 0V15"/>`,
  respect: `<circle cx="16" cy="5.5" r="2.2"/><path d="M15 8 9 11.5l-2.5 9M9 11.5l3.5 4.5-.5 5M15 8l1 5.5 3.5 1"/>`,
  handshake: `<path d="M2.5 11.5l4-4 4 1.5 3-2 3 1 5 4M2.5 11.5l3 3M21.5 12.5l-3 3"/><path d="M8.5 13.5l2.5 2.5M10.5 12l3 3M12.5 10.5l3 3"/>`,
  slay: `<circle cx="12" cy="4.5" r="2.2"/><path d="M12 7v7l-2.5 7M12 14l2.5 7M12 9l-3.5 2.5 1.5 2M12 9l3-3 1.5-3"/>`,
  flex: `<path d="M4 14c0-3 2-5 4.5-5 1-2.5 2.5-4.5 5-4.5 1.5 0 2.5 1 2.5 2.5s-1 2-2.5 2l-1.5 1c2.5-.5 6.5.5 6.5 5 0 3-2.5 5-6 5H8c-2.5 0-4-2-4-6z"/>`,
  fire: `<path d="M12 21.5c-3.8 0-6.5-2.6-6.5-6.3 0-4 3-6 4-9.7 2.3 1.6 3.7 3.6 3.7 6.2.8-.6 1.4-1.6 1.6-2.7 2 1.6 3.7 3.8 3.7 6.4 0 3.6-2.7 6.1-6.5 6.1z"/>`,
};

export type IconName = keyof typeof P;

/** An inline SVG icon. `cls` adds animation classes (ico-spin, ico-pulse, ico-bob, ico-pop). */
export function icon(name: string, cls = "", size = 24): string {
  const body = P[name] ?? P.info;
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** An icon as a DOM element. */
export function iconEl(name: string, cls = "", size = 24): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = icon(name, cls, size);
  return t.content.firstElementChild as SVGElement;
}
