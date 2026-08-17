// src/lib/oauth/providers/kimiCoding.ts
import { KIMI_CODING_CONFIG } from "../constants.ts";
import type { DeviceCodeData, DevicePollRaw, MappedOAuthTokens } from "../types.ts";

const REQUEST_TIMEOUT_MS = 10_000;

interface KimiTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Kimi Coding OAuth (RFC 8628 device code flow, form-encoded, no PKCE).
 *
 * Trimmed: OmniRoute additionally sends persistent X-Msh-* device-identity headers
 * (device id/model/os) derived from `open-sse/config/providers/registry/kimi/...`,
 * which is deliberately not ported (open-sse is out of scope). Kimi's anti-bot
 * pipeline may be stricter about missing identity headers than other providers —
 * flagged as a known simplification, not a silent gap.
 */
export const kimiCoding = {
  config: KIMI_CODING_CONFIG,
  flowType: "device_code" as const,

  async requestDeviceCode(config: typeof KIMI_CODING_CONFIG): Promise<DeviceCodeData> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(config.deviceCodeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: config.clientId }),
        signal: ctrl.signal,
      });
      if (!response.ok) {
        throw new Error(`Kimi device code request failed: ${await response.text()}`);
      }
      const data = await response.json();
      if (!data?.device_code || !data?.user_code || !data?.verification_uri_complete) {
        throw new Error("Kimi device authorization response missing required fields");
      }
      return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri || "",
        verificationUriComplete: data.verification_uri_complete,
        expiresIn: data.expires_in ?? 900,
        interval: data.interval || 5,
      };
    } finally {
      clearTimeout(timer);
    }
  },

  async pollToken(config: typeof KIMI_CODING_CONFIG, deviceCode: string): Promise<DevicePollRaw> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
        signal: ctrl.signal,
      });
      let data: DevicePollRaw["data"];
      try {
        data = await response.json();
      } catch {
        data = { error: "invalid_response" };
      }
      return { ok: response.ok, data };
    } finally {
      clearTimeout(timer);
    }
  },

  mapTokens(tokens: KimiTokenResponse): MappedOAuthTokens {
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in ?? null,
    };
  },
};
