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
