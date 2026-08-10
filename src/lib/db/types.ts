export type WireFormat = "openai" | "anthropic" | "gemini";
export type ProviderKind = "apikey" | "oauth";
export type ToolMode = "native" | "trigger" | "off";

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  wireFormat: WireFormat;
  enabled: boolean;
}

export interface Connection {
  id: number;
  providerId: string;
  label: string;
  apiKey: string | null;
  priority: number;
  cooldownUntil: number | null;
  lastError: string | null;
  /**
   * True when `api_key` holds a stored ciphertext (`enc:v1:` prefix) that could
   * not be decrypted — a rotated/lost STORAGE_ENCRYPTION_KEY or a corrupted
   * value. Distinguishes "credential present but undecryptable" from
   * "credential genuinely absent", which `decrypt()` otherwise collapses to
   * null. Callers that skip null-key connections must surface this rather than
   * silently reporting "no connection available".
   */
  credentialDecryptFailed: boolean;
  enabled: boolean;
}

export interface ApiKeyRecord {
  id: number;
  keyHash: string;
  label: string;
  presetId: number | null;
  toolMode: ToolMode;
  rateLimitPerMin: number;
  createdAt: number;
}
