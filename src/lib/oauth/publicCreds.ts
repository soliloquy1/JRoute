// src/lib/oauth/publicCreds.ts
/**
 * Public credentials decoder — trimmed port of OmniRoute's
 * `open-sse/utils/publicCreds.ts`, keeping only the 3 embedded client ids the
 * expressible OAuth providers need (claude, xai-oauth/grok, kimi-coding).
 *
 * These are public OAuth client_id values for native/installed apps using PKCE
 * or device-code flows (RFC 8252) — not secrets. They are masked (XOR, not
 * encryption) purely to stay off secret-scanner regexes; see
 * docs/security/PUBLIC_CREDS.md in the OmniRoute source repo for the full
 * rationale. Hard Rule #11: never embed these as string literals — always via
 * `resolvePublicCred()`.
 */

const MASK = "omniroute-public-v1";

function unmaskBytes(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] ^ MASK.charCodeAt(i % MASK.length));
  }
  return out;
}

function maskBytes(plain: string): number[] {
  const arr: number[] = [];
  for (let i = 0; i < plain.length; i++) {
    arr.push(plain.charCodeAt(i) ^ MASK.charCodeAt(i % MASK.length));
  }
  return arr;
}

const RAW_VALUE_PATTERN =
  /^(AIza[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]+|\d+-[a-z0-9]{32}\.apps\.googleusercontent\.com|Iv1\.[a-f0-9]+)$/;
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function looksLikePrintablePlain(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/** Decode a raw literal or masked base64 credential. Empty/nullish input returns "". */
export function decodePublicCred(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "";
  if (RAW_VALUE_PATTERN.test(value)) return value;
  if (!STRICT_BASE64.test(value)) return value;
  try {
    const buf = Buffer.from(value, "base64");
    if (buf.length === 0) return value;
    const arr: number[] = [];
    for (let i = 0; i < buf.length; i++) arr.push(buf[i]);
    const decoded = unmaskBytes(arr);
    return looksLikePrintablePlain(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

/** Used by maintainers when adding a new embedded default. Not used at runtime. */
export function encodePublicCred(plain: string): string {
  if (!plain) return "";
  return Buffer.from(maskBytes(plain)).toString("base64");
}

function decodePublicCredBytes(bytes: readonly number[]): string {
  if (!bytes || bytes.length === 0) return "";
  return unmaskBytes(bytes);
}

// Byte-for-byte copies of OmniRoute's EMBEDDED_DEFAULTS entries for these 3 keys —
// same MASK, same public values, verified to decode to the identical real client ids.
const EMBEDDED_DEFAULTS = {
  claude_id: [
    86, 9, 95, 10, 64, 90, 69, 21, 72, 72, 70, 68, 0, 65, 93, 87, 73, 79, 28, 87, 85, 11, 13, 95,
    90, 76, 64, 81, 73, 65, 76, 84, 94, 15, 86, 72,
  ],
  kimi_id: [
    94, 90, 11, 92, 20, 89, 66, 69, 72, 73, 65, 76, 86, 65, 93, 7, 75, 20, 28, 86, 90, 94, 95, 95,
    90, 64, 69, 83, 78, 18, 65, 90, 15, 89, 90, 21,
  ],
  grok_id: [
    13, 92, 15, 89, 66, 91, 76, 70, 72, 29, 71, 70, 3, 65, 93, 84, 72, 23, 28, 87, 92, 88, 15, 95,
    91, 22, 71, 87, 20, 66, 67, 86, 13, 81, 81, 21,
  ],
} as const;

export type EmbeddedDefaultKey = keyof typeof EMBEDDED_DEFAULTS;

/**
 * Resolve a public credential with `process.env` override priority:
 *   1. `process.env[envName]` if set and non-empty (raw or masked, both work)
 *   2. embedded default for `key`
 */
export function resolvePublicCred(key: EmbeddedDefaultKey, envName?: string): string {
  if (envName) {
    const fromEnv = process.env[envName];
    if (fromEnv && fromEnv.trim()) return decodePublicCred(fromEnv.trim());
  }
  return decodePublicCredBytes(EMBEDDED_DEFAULTS[key]);
}
