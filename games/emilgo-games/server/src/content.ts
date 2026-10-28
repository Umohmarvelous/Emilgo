// The content manifest, as this server referees it and serves it (SPEC-V3 §1.3).
//
//   CONTENT_FILE         a manifest JSON to use instead of the one built into
//                        the game (this week's modes and rotation). Checked like
//                        any manifest: a bad mode is dropped and logged.
//   CONTENT_SIGNING_KEY  the Ed25519 private key (PKCS#8 PEM, or base64 of its
//                        DER) that signs it. The game holds the public half
//                        (src/content/load.ts CONTENT_PUBLIC_KEY). Unset: the
//                        manifest is not served, and phones play the built-in one.
//
// Make a key pair:
//   openssl genpkey -algorithm ed25519 -out content.pem
//   openssl pkey -in content.pem -pubout -outform DER | tail -c 32 | base64   (→ CONTENT_PUBLIC_KEY)

import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

import { BUILTIN_MANIFEST, type Manifest } from "../../src/content/modes";
import { checkManifest } from "../../src/content/validate";

export interface Served {
  manifest: Manifest;
  /** `{ body, sig }` as sent to phones, or null when no signing key is set. */
  signed: string | null;
}

function keyFrom(text: string): KeyObject {
  const t = text.trim();
  if (t.startsWith("-----BEGIN")) return createPrivateKey(t);
  return createPrivateKey({ key: Buffer.from(t, "base64"), format: "der", type: "pkcs8" });
}

/** Sign a manifest's exact text (phones check these very bytes). */
export function signManifest(body: string, key: KeyObject): string {
  return JSON.stringify({ body, sig: sign(null, Buffer.from(body, "utf8"), key).toString("base64") });
}

export function loadContent(env: NodeJS.ProcessEnv, log: (line: string) => void = console.log): Served {
  let manifest = BUILTIN_MANIFEST;
  if (env.CONTENT_FILE) {
    const checked = checkManifest(JSON.parse(readFileSync(env.CONTENT_FILE, "utf8")));
    if (!checked) throw new Error(`CONTENT_FILE ${env.CONTENT_FILE} is not a manifest`);
    for (const d of checked.dropped) log(`content: dropped ${d.id}: ${d.errors.join(", ")}`);
    manifest = checked.manifest;
  }
  const signed = env.CONTENT_SIGNING_KEY ? signManifest(JSON.stringify(manifest), keyFrom(env.CONTENT_SIGNING_KEY)) : null;
  return { manifest, signed };
}
