import type { RichPresetJson } from "../prompts/stPresetSchema.ts";

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
  /** User-chosen routing key for this provider's models. A model is requested as
   *  `modelPrefix/nativeId` (e.g. `or/gpt-5.6-sol`) and routes only to this provider.
   *  Empty string means the provider serves bare (unprefixed) model ids. */
  modelPrefix?: string;
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

export type LorebookScope = "character" | "global";

export interface Lorebook {
  id: number;
  name: string;
  source: string;
  enabled: boolean;
  triggerConfig: string | null;
  scope: LorebookScope;
  createdAt: number;
}

export type PromptBlockKind = "prepend" | "append";

export interface PromptBlock {
  id: number;
  name: string;
  kind: PromptBlockKind;
  content: string;
  createdAt: number;
}

export interface Preset {
  id: number;
  name: string;
  prependBlockId: number | null;
  appendBlockId: number | null;
  toolMode: ToolMode;
  createdAt: number;
  lorebookIds: number[];
}

export interface RichPreset {
  id: number;
  name: string;
  raw: RichPresetJson;
  charName: string;
  userName: string;
  createdAt: number;
  lorebookIds: number[];
}

export type McpTransport = "http" | "sse" | "stdio";

export interface McpServer {
  id: number;
  name: string;
  transport: McpTransport;
  target: string;
  enabled: boolean;
  toolAllowlist: string | null;
  triggerPattern: string | null;
  confirmedAt: number | null;
}

export interface ApiKeyRecord {
  id: number;
  keyHash: string;
  label: string;
  presetId: number | null;
  richPresetId: number | null;
  toolMode: ToolMode;
  rateLimitPerMin: number;
  createdAt: number;
}
