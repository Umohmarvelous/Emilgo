// Avatars (v5; the owner: "add back the avatar profile picture and let players
// change it"). Twelve drawn in code (no files to download): a masked operator's
// face, or crossed blades, in different colours. Original artwork. A player can
// also pick a picture from their phone; it stays on this phone (shrunk to
// 128 px), and other players never receive it.

const face = (bg: string, mask: string, skin: string, trim: string): string => `
  <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="64" height="64" fill="${bg}"/>
    <path d="M6 64c1-14 12-20 26-20s25 6 26 20z" fill="${mask}"/>
    <path d="M17 26c0-11 7-17 15-17s15 6 15 17c0 12-6 21-15 21s-15-9-15-21z" fill="${mask}"/>
    <path d="M20 22c4-2 8-3 12-3s8 1 12 3c1 3 0 6-1 8-3 2-5 3-7 3l-1 7h-6l-1-7c-2 0-4-1-7-3-1-2-2-5-1-8z" fill="${skin}"/>
    <ellipse cx="25.5" cy="26" rx="3.4" ry="2.2" fill="#fff"/><ellipse cx="38.5" cy="26" rx="3.4" ry="2.2" fill="#fff"/>
    <circle cx="25.8" cy="26" r="1.5" fill="#1b130d"/><circle cx="38.2" cy="26" r="1.5" fill="#1b130d"/>
    <path d="M20 22.6c2.5-1.3 7-2 9-1.2M44 22.6c-2.5-1.3-7-2-9-1.2" stroke="#2a1d14" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M12 56h40" stroke="${trim}" stroke-width="3"/>
  </svg>`;

const blades = (bg: string, steel: string, grip: string): string => `
  <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="64" height="64" fill="${bg}"/>
    <path d="M51 7l6 0 0 6-30 30-6-6z" fill="${steel}"/><path d="M13 7l-6 0 0 6 30 30 6-6z" fill="${steel}"/>
    <path d="M17 37l10 10-4 4-3-3-6 6-4-4 6-6-3-3z" fill="${grip}"/><path d="M47 37l-10 10 4 4 3-3 6 6 4-4-6-6 3-3z" fill="${grip}"/>
  </svg>`;

export const AVATARS: { id: string; svg: string }[] = [
  { id: "op-black", svg: face("#2a2d31", "#0f1012", "#e8c4a8", "#f2b632") },
  { id: "op-olive", svg: face("#39402b", "#1a1e13", "#e8c4a8", "#b4c26a") },
  { id: "op-red", svg: face("#5e1a1d", "#160c0d", "#e8c4a8", "#ff5a4a") },
  { id: "op-steel", svg: face("#3c4a57", "#14181d", "#e8c4a8", "#8fb7d9") },
  { id: "op-sand", svg: face("#6f5f43", "#201b12", "#e8c4a8", "#e2c58b") },
  { id: "op-violet", svg: face("#3d2f5c", "#120e1c", "#e8c4a8", "#b596f0") },
  { id: "bl-amber", svg: blades("#1b1d20", "#e7eaee", "#f2b632") },
  { id: "bl-red", svg: blades("#2b1012", "#e7eaee", "#ff5a4a") },
  { id: "bl-olive", svg: blades("#20251a", "#d9dcc9", "#9fb35c") },
  { id: "bl-blue", svg: blades("#121b26", "#dfe9f2", "#5aa8e6") },
  { id: "bl-white", svg: blades("#d8d6cf", "#26292d", "#7a2a2a") },
  { id: "bl-gold", svg: blades("#141210", "#f3d27a", "#a97c1f") },
];

/** What goes in an avatar's box: the player's pick (a preset's id or a picture), or the platform's picture, else `fallback`. */
export function avatarInner(pick: string, platform: string | null, fallback: string): string | null {
  if (pick.startsWith("data:image/")) return `<img alt="" src="${pick.replace(/"/g, "")}">`;
  const preset = AVATARS.find((a) => a.id === pick);
  if (preset) return preset.svg;
  if (platform) return `<img alt="" src="${platform.replace(/"/g, "")}">`;
  return fallback ? null : AVATARS[0].svg;
}

/** A picture from the phone, as a small square data URL (or null). */
export function shrinkPicture(file: File): Promise<string | null> {
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const S = 128;
      const c = document.createElement("canvas");
      c.width = c.height = S;
      const g = c.getContext("2d")!;
      const k = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, S, S);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      res(null);
    };
    img.src = url;
  });
}
