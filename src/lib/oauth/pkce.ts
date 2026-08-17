// src/lib/oauth/pkce.ts
import crypto from "crypto";

/** PKCE code verifier (RFC 7636 §4.1: 43-128 chars). */
export function generateCodeVerifier(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** PKCE code challenge from verifier (S256 method). */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** Random state for CSRF protection. */
export function generateState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

export function generatePKCE(verifierBytes = 32): PkcePair {
  const codeVerifier = generateCodeVerifier(verifierBytes);
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  return { codeVerifier, codeChallenge, state };
}
