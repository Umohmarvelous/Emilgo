// Weekly content without a store release (SPEC-V3 §1.3). The game server
// serves the manifest as `{ body, sig }`: the JSON text and its Ed25519
// signature. The phone checks the signature against the key built into the
// game (CONTENT_PUBLIC_KEY), checks every mode (validate.ts), keeps the newest
// good one in storage, and otherwise plays the manifest it was built with.
//
// No key built in (today: the owner makes one when hosting starts) means no
// downloads: the built-in manifest only. A phone whose browser can't check
// Ed25519 does the same.

/** Where the verified copy is kept: the host's storage (load/save of the Host). */
interface Storage {
  load(key: string): string | null;
  save(key: string, value: string): void;
}
import { BUILTIN_MANIFEST, type Manifest } from "./modes";
import { checkManifest } from "./validate";

/**
 * The content key's public half, base64 (32 bytes, raw Ed25519). Its private
 * half lives only on the server (CONTENT_SIGNING_KEY). Null: built-in only.
 */
export const CONTENT_PUBLIC_KEY: string | null = null;

const CACHE_KEY = "content.v1";

export interface Signed {
  body: string;
  sig: string;
}

function b64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Is `body` signed by `publicKey` (raw Ed25519, base64)? False when the browser can't tell. */
export async function verifySigned(s: Signed, publicKey: string): Promise<boolean> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof s.body !== "string" || typeof s.sig !== "string" || s.body.length > 200_000) return false;
    const key = await subtle.importKey("raw", b64(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await subtle.verify({ name: "Ed25519" }, key, b64(s.sig), new TextEncoder().encode(s.body));
  } catch {
    return false;
  }
}

/** A signed manifest → a checked manifest, or null. */
export async function openSigned(s: Signed, publicKey: string): Promise<Manifest | null> {
  if (!(await verifySigned(s, publicKey))) return null;
  try {
    return checkManifest(JSON.parse(s.body))?.manifest ?? null;
  } catch {
    return null;
  }
}

/** Newer wins; the built-in one is the floor. */
function newer(a: Manifest, b: Manifest | null): Manifest {
  return b && b.issued > a.issued ? b : a;
}

/** The game's content: built-in, a verified copy kept on the phone, then a fresh one from the server. */
export class Content {
  manifest: Manifest = BUILTIN_MANIFEST;
  /** Called when a newer manifest has been verified (menus redraw). */
  onChange: (() => void) | null = null;

  constructor(
    private readonly host: Storage,
    private readonly publicKey: string | null = CONTENT_PUBLIC_KEY,
  ) {}

  /** Load the copy kept on the phone (once, at boot; offline is fine). */
  async boot(): Promise<void> {
    if (!this.publicKey) return;
    const raw = this.host.load(CACHE_KEY);
    if (!raw) return;
    try {
      this.manifest = newer(this.manifest, await openSigned(JSON.parse(raw) as Signed, this.publicKey));
    } catch {
      /* a damaged copy: the built-in one stands */
    }
  }

  /** Ask the game server for this week's manifest (ws://… → http://…/content/v1/manifest). */
  async refresh(serverWs: string | null): Promise<void> {
    if (!this.publicKey || !serverWs) return;
    const url = serverWs.replace(/^ws/, "http").replace(/\/+$/, "") + "/content/v1/manifest";
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) return;
      const signed = (await res.json()) as Signed;
      const m = await openSigned(signed, this.publicKey);
      if (!m || m.issued <= this.manifest.issued) return;
      this.manifest = m;
      this.host.save(CACHE_KEY, JSON.stringify(signed));
      this.onChange?.();
    } catch {
      /* offline, or the server is old: keep what we have */
    }
  }
}
