// src/lib/oauth/types.ts

/** Normalized token shape every provider's `mapTokens()` returns. */
export interface MappedOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds until expiry, or null when the provider doesn't report one (kilocode). */
  expiresIn: number | null;
}

export type OAuthFlowType = "authorization_code_pkce" | "authorization_code" | "device_code";

export interface DeviceCodeData {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface DevicePollRaw {
  ok: boolean;
  data: {
    access_token?: string;
    error?: string;
    error_description?: string;
    [key: string]: unknown;
  };
}
