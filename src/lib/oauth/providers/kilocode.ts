// src/lib/oauth/providers/kilocode.ts
import { KILOCODE_CONFIG } from "../constants.ts";
import type { DeviceCodeData, DevicePollRaw, MappedOAuthTokens } from "../types.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * KiloCode custom device-auth flow — not RFC 8628: init returns a bare `code` +
 * `verificationUrl`, poll is a plain GET keyed by the code (no client_id, no PKCE).
 * The issued access token has no refresh_token (long-lived) — see refresh.ts.
 */
export const kilocode = {
  config: KILOCODE_CONFIG,
  flowType: "device_code" as const,

  async requestDeviceCode(config: typeof KILOCODE_CONFIG): Promise<DeviceCodeData> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(config.initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many pending authorization requests. Try again later.");
        }
        throw new Error(`Kilo Code device auth initiation failed: ${await response.text()}`);
      }
      const data = await response.json();
      return {
        deviceCode: data.code,
        userCode: data.code,
        verificationUri: data.verificationUrl,
        verificationUriComplete: data.verificationUrl,
        expiresIn: data.expiresIn || 300,
        interval: 3,
      };
    } finally {
      clearTimeout(timer);
    }
  },

  async pollToken(config: typeof KILOCODE_CONFIG, deviceCode: string): Promise<DevicePollRaw> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${config.pollUrlBase}/${deviceCode}`, { signal: ctrl.signal });
      if (response.status === 202) return { ok: false, data: { error: "authorization_pending" } };
      if (response.status === 403) {
        return {
          ok: false,
          data: { error: "access_denied", error_description: "Authorization denied by user" },
        };
      }
      if (response.status === 410) {
        return {
          ok: false,
          data: { error: "expired_token", error_description: "Authorization code expired" },
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          data: { error: "poll_failed", error_description: `Poll failed: ${response.status}` },
        };
      }
      const data = await response.json();
      if (data.status === "approved" && data.token) {
        return { ok: true, data: { access_token: data.token } };
      }
      return { ok: false, data: { error: "authorization_pending" } };
    } finally {
      clearTimeout(timer);
    }
  },

  mapTokens(tokens: { access_token: string }): MappedOAuthTokens {
    return { accessToken: tokens.access_token, refreshToken: null, expiresIn: null };
  },
};
