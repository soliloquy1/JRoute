import type { RichPresetJson } from "../prompts/stPresetSchema.ts";
import type { LogitBiasEntry } from "../prompts/logitBiasSchema.ts";
import type { RegexScript } from "../prompts/regexScriptSchema.ts";
import type { ReasoningTagPair } from "../prompts/reasoningTagSchema.ts";

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
  /** OAuth provider key (e.g. "claude", "xai-oauth") when kind === "oauth". Null for API-key providers. */
  oauthProvider?: string | null;
  /** Free-form JSON bag for provider-specific configuration (scopes, tenant, region, …). */
  providerSpecificData?: string | null;
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
  /** Free-form JSON bag for connection-specific configuration (per-connection OAuth state, etc.). */
  providerSpecificData?: string | null;
  /** Quota-window threshold config (JSON): { requests?: number; tokens?: number; windowMs?: number }. */
  quotaWindowThresholds?: string | null;
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
  reasoningTags: ReasoningTagPair[];
}

export interface LogitBiasPreset {
  id: number;
  name: string;
  entries: LogitBiasEntry[];
  createdAt: number;
}

export type McpTransport = "http" | "sse" | "stdio" | "builtin";

export interface RegexPreset {
  id: number;
  name: string;
  scripts: RegexScript[];
  createdAt: number;
}

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

export type SearchProviderKind = "brave" | "serpapi" | "google_cse";

export interface SearchProvider {
  id: number;
  kind: SearchProviderKind;
  label: string;
  /** `null` when no key is stored, or when a stored ciphertext could not be decrypted —
   * `credentialDecryptFailed` tells the two apart. */
  apiKey: string | null;
  credentialDecryptFailed: boolean;
  configJson: string | null;
  createdAt: number;
}

export interface ApiKeyRecord {
  id: number;
  keyHash: string;
  label: string;
  presetId: number | null;
  richPresetId: number | null;
  logitBiasPresetId: number | null;
  regexPresetId: number | null;
  toolMode: ToolMode;
  rateLimitPerMin: number;
  createdAt: number;
}
