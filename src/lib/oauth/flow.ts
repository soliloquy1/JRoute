// src/lib/oauth/flow.ts
/**
 * Thin orchestrator over the per-provider handlers — trimmed port of OmniRoute's
 * `src/lib/oauth/providers.ts` (generateAuthData/exchangeTokens/requestDeviceCode/
 * pollForToken), minus the Google-browser-redirect and import_token branches (none of
 * the 6 expressible providers need them).
 */
import { generatePKCE } from "./pkce.ts";
import { getOAuthProvider } from "./providers/index.ts";
import type { DeviceCodeData, MappedOAuthTokens } from "./types.ts";

export interface AuthData {
  authUrl: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
}

interface PkceHandler {
  flowType: "authorization_code_pkce";
  config: unknown;
  pkceVerifierBytes?: number;
  buildAuthUrl(config: unknown, redirectUri: string, state: string, codeChallenge: string): string;
  exchangeToken(
    config: unknown,
    code: string,
    redirectUri: string,
    codeVerifier: string,
    state: string
  ): Promise<unknown>;
  mapTokens(tokens: unknown): MappedOAuthTokens;
}

interface AuthCodeHandler {
  flowType: "authorization_code";
  config: unknown;
  buildAuthUrl(config: unknown, redirectUri: string): string;
  exchangeToken(config: unknown, code: string, redirectUri: string): Promise<unknown>;
  mapTokens(tokens: unknown): MappedOAuthTokens;
}

interface DeviceCodeHandler {
  flowType: "device_code";
  config: unknown;
  requestDeviceCode(config: unknown): Promise<DeviceCodeData>;
  pollToken(config: unknown, deviceCode: string): Promise<{ ok: boolean; data: Record<string, unknown> }>;
  mapTokens(tokens: unknown): MappedOAuthTokens;
}

type Handler = PkceHandler | AuthCodeHandler | DeviceCodeHandler;

function asHandler(key: string): Handler {
  return getOAuthProvider(key) as unknown as Handler;
}

/** Build the auth URL + PKCE material for the browser-driven (non device-code) flows. */
export function generateAuthData(providerKey: string, redirectUri: string): AuthData {
  const provider = asHandler(providerKey);
  const pkce = generatePKCE(provider.flowType === "authorization_code_pkce" ? provider.pkceVerifierBytes ?? 32 : 32);

  let authUrl: string;
  if (provider.flowType === "authorization_code_pkce") {
    authUrl = provider.buildAuthUrl(provider.config, redirectUri, pkce.state, pkce.codeChallenge);
  } else if (provider.flowType === "authorization_code") {
    authUrl = provider.buildAuthUrl(provider.config, redirectUri);
  } else {
    throw new Error(`${providerKey} does not support the browser authorize flow`);
  }

  return { authUrl, state: pkce.state, codeVerifier: pkce.codeVerifier, codeChallenge: pkce.codeChallenge, redirectUri };
}

/** Exchange an authorization code for tokens. `codeVerifier`/`state` are ignored by
 * providers that don't need them (cline). */
export async function exchangeTokens(
  providerKey: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  state: string
): Promise<MappedOAuthTokens> {
  const provider = asHandler(providerKey);
  if (provider.flowType === "device_code") {
    throw new Error(`${providerKey} does not support code exchange`);
  }
  const tokens =
    provider.flowType === "authorization_code_pkce"
      ? await provider.exchangeToken(provider.config, code, redirectUri, codeVerifier, state)
      : await provider.exchangeToken(provider.config, code, redirectUri);
  return provider.mapTokens(tokens);
}

export async function requestDeviceCode(providerKey: string): Promise<DeviceCodeData> {
  const provider = asHandler(providerKey);
  if (provider.flowType !== "device_code") {
    throw new Error(`${providerKey} does not support device code flow`);
  }
  return provider.requestDeviceCode(provider.config);
}

export interface DevicePollOutcome {
  success: boolean;
  pending?: boolean;
  tokens?: MappedOAuthTokens;
  error?: string;
  errorDescription?: string;
}

export async function pollForToken(providerKey: string, deviceCode: string): Promise<DevicePollOutcome> {
  const provider = asHandler(providerKey);
  if (provider.flowType !== "device_code") {
    throw new Error(`${providerKey} does not support device code flow`);
  }
  const result = await provider.pollToken(provider.config, deviceCode);
  if (result.ok && result.data.access_token) {
    return { success: true, tokens: provider.mapTokens(result.data) };
  }
  const errorCode = typeof result.data.error === "string" ? result.data.error : undefined;
  const pending = errorCode === "authorization_pending" || errorCode === "slow_down";
  return {
    success: false,
    pending,
    error: errorCode,
    errorDescription:
      typeof result.data.error_description === "string" ? result.data.error_description : undefined,
  };
}
