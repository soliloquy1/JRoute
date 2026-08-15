/**
 * Provider catalog data — curated port of OmniRoute's operator-facing provider list.
 *
 * This is DATA ONLY (no behavior). JRoute's engine (`jroute/`) speaks three wire
 * formats — `openai`, `anthropic`, `gemini` (see `jroute/executor.ts` WIRE_DESCRIPTORS) —
 * and does NOT port OmniRoute's `open-sse` combo/routing engine. Therefore an OAuth
 * provider is only *expressible* (and thus shippable as a catalog row) when it maps to
 * one of those three wire formats AND a bearer token — i.e. no bespoke request signing,
 * RPC, or desktop-local credential store.
 *
 * `wireFormat: null` marks a DEFERRED provider: documented here (so the enumeration is
 * the gate, per plan Phase 0 step 0) but intentionally NOT seeded into the `providers`
 * table — shipping it would create a dead row JRoute cannot proxy.
 *
 * Full enumeration + rationale: see `OAUTH_ENUMERATION.md`.
 */

import type { ProviderKind, WireFormat } from "../db/types.ts";

export type CatalogCategory = "oauth" | "apikey" | "compatible" | "local";

export interface CatalogProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  category: CatalogCategory;
  baseUrl: string;
  /** Wire format JRoute proxies through. `null` ⇒ deferred (not shippable). */
  wireFormat: WireFormat | null;
  /** OAuth provider key (drives the Phase 2 token flow) when kind === "oauth". */
  oauthProvider?: string;
  /** Optional default model prefix (routing key). */
  modelPrefix?: string;
  /** Free-form default provider-specific config bag. */
  providerSpecificDefaults?: Record<string, unknown>;
  /** Deferred-only: why this provider cannot be proxied through JRoute's 3 wire formats. */
  deferredReason?: string;
  icon?: string;
  color?: string;
}

/**
 * Curated, shippable catalog: expressible OAuth providers + a trimmed API-key set +
 * local/custom-compatible templates. Ordered for the grid.
 */
export const CATALOG_PROVIDERS: CatalogProvider[] = [
  // ── Expressible OAuth (openai/anthropic/gemini wire + bearer token) ──
  {
    id: "claude",
    name: "Claude Code",
    kind: "oauth",
    category: "oauth",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    oauthProvider: "claude",
    icon: "smart_toy",
    color: "#D97757",
  },
  {
    id: "xai-oauth",
    name: "xAI OAuth (Grok)",
    kind: "oauth",
    category: "oauth",
    // Registry: open-sse/config/providers/registry/xai-oauth → xai.baseUrl
    // "https://api.x.ai/v1/chat/completions". The executor appends the wire path
    // ("/chat/completions"), so the catalog baseUrl MUST keep the /v1 version segment.
    baseUrl: "https://api.x.ai/v1",
    wireFormat: "openai",
    oauthProvider: "xai-oauth",
    icon: "auto_awesome",
    color: "#1DA1F2",
  },
  {
    id: "kimi-coding",
    name: "Kimi Code CLI",
    kind: "oauth",
    category: "oauth",
    // Registry: open-sse/config/providers/registry/moonshot →
    // "https://api.moonshot.ai/v1/chat/completions".
    baseUrl: "https://api.moonshot.ai/v1",
    wireFormat: "openai",
    oauthProvider: "kimi-coding",
    icon: "psychology",
    color: "#1E40AF",
  },
  {
    id: "kilocode",
    name: "Kilo Code",
    kind: "oauth",
    category: "oauth",
    // Registry: open-sse/config/providers/registry/kilocode →
    // "https://api.kilo.ai/api/openrouter/chat/completions".
    baseUrl: "https://api.kilo.ai/api/openrouter",
    wireFormat: "openai",
    oauthProvider: "kilocode",
    providerSpecificDefaults: { anonymousFallback: true },
    icon: "code",
    color: "#FF6B35",
  },
  {
    id: "cline",
    name: "Cline",
    kind: "oauth",
    category: "oauth",
    // Registry: open-sse/config/providers/registry/cline →
    // "https://api.cline.bot/api/v1/chat/completions" (api.coline.ai does not exist).
    baseUrl: "https://api.cline.bot/api/v1",
    wireFormat: "openai",
    oauthProvider: "cline",
    icon: "smart_toy",
    color: "#5B9BD5",
  },
  {
    id: "clinepass",
    name: "ClinePass",
    kind: "oauth",
    category: "oauth",
    // Registry: open-sse/config/providers/registry/clinepass →
    // "https://api.cline.bot/api/v1/chat/completions".
    baseUrl: "https://api.cline.bot/api/v1",
    wireFormat: "openai",
    oauthProvider: "clinepass",
    icon: "smart_toy",
    color: "#9D4EDD",
  },

  // ── Curated API-key providers ──
  {
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    category: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    icon: "openai",
    color: "#10A37F",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    category: "apikey",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    icon: "anthropic",
    color: "#D97757",
  },
  {
    id: "google",
    name: "Google Gemini",
    kind: "apikey",
    category: "apikey",
    baseUrl: "https://generativelanguage.googleapis.com",
    wireFormat: "gemini",
    icon: "google",
    color: "#4285F4",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "apikey",
    category: "apikey",
    // Registry: open-sse/config/providers/registry/deepseek → "https://api.deepseek.com/v1/chat/completions".
    baseUrl: "https://api.deepseek.com/v1",
    wireFormat: "openai",
    icon: "deepseek",
    color: "#4D6BFE",
  },
  {
    id: "groq",
    name: "Groq",
    kind: "apikey",
    category: "apikey",
    baseUrl: "https://api.groq.com/openai/v1",
    wireFormat: "openai",
    icon: "groq",
    color: "#F55036",
  },
  {
    id: "xai",
    name: "xAI",
    kind: "apikey",
    category: "apikey",
    // Registry: open-sse/config/providers/registry/xai → "https://api.x.ai/v1/chat/completions".
    baseUrl: "https://api.x.ai/v1",
    wireFormat: "openai",
    icon: "auto_awesome",
    color: "#1DA1F2",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "apikey",
    category: "apikey",
    baseUrl: "https://openrouter.ai/api/v1",
    wireFormat: "openai",
    icon: "openrouter",
    color: "#0A0A0A",
  },
];

/**
 * Deferred OAuth providers — documented for the enumeration gate but NOT shippable
 * (wireFormat: null). Each requires a bespoke executor, RPC, or desktop-local
 * credential store that JRoute's 3-wire engine cannot express.
 */
export const DEFERRED_OAUTH_PROVIDERS: CatalogProvider[] = [
  {
    id: "ghe-copilot",
    name: "GitHub Enterprise Copilot",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "ghe-copilot",
    deferredReason:
      "Copilot token exchange + enterprise instance URL + bespoke GitHub Copilot headers (GithubExecutor).",
  },
  {
    id: "grok-cli",
    name: "Grok Build",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "grok-cli",
    deferredReason: "cli-chat-proxy.grok.com / grok-build JWT sessions via Grok Build CLI (bespoke).",
  },
  {
    id: "qoder",
    name: "Qoder",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "qoder",
    deferredReason: "QoderExecutor (bespoke request signing/RPC).",
  },
  {
    id: "agy",
    name: "Antigravity CLI",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "agy",
    deferredReason: "AntigravityExecutor (bespoke).",
  },
  {
    id: "kiro",
    name: "Kiro AI",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "kiro",
    deferredReason: "KiroExecutor + desktop `kiro://` protocol (bespoke + desktop-local).",
  },
  {
    id: "amazon-q",
    name: "Amazon Q",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "amazon-q",
    deferredReason: "AWS Builder ID / refresh-token flow shared with Kiro (bespoke).",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "antigravity",
    deferredReason: "AntigravityExecutor (bespoke).",
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "codex",
    deferredReason: "CodexExecutor (bespoke request signing/RPC).",
  },
  {
    id: "github",
    name: "GitHub Copilot",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "github",
    deferredReason: "GithubExecutor (bespoke Copilot token exchange + headers).",
  },
  {
    id: "gitlab-duo",
    name: "GitLab Duo",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "gitlab-duo",
    deferredReason: "GitLab Duo OAuth (PAT/exchange) not mappable to a single wire+bearer (bespoke).",
  },
  {
    id: "cursor",
    name: "Cursor IDE",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "cursor",
    deferredReason: "CursorExecutor — protobuf RPC `agent.v1.AgentService/Run` (bespoke).",
  },
  {
    id: "zed",
    name: "Zed IDE",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    deferredReason: "Credentials imported from the OS keychain (desktop-local) — not a server OAuth flow.",
  },
  {
    id: "zed-hosted",
    name: "Zed Hosted Models",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    deferredReason: "Native-app sign-in with one-time RSA keypair (bespoke).",
  },
  {
    id: "trae",
    name: "Trae",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "trae",
    deferredReason: "Cloud-IDE-JWT header (`Authorization: Cloud-IDE-JWT <token>`) — non-standard auth header.",
  },
  {
    id: "raycast",
    name: "Raycast Pro AI",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    deferredReason: "macOS app sqlite credential capture (desktop-local) — excluded from shipped set.",
  },
  {
    id: "devin-desktop",
    name: "Devin Desktop",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    deferredReason: "Pasted Devin API key (credential-paste, non-standard auth) — not a device-flow bearer.",
  },
  {
    id: "devin-cli",
    name: "Devin CLI",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    deferredReason: "Requires Devin CLI binary / WINDSURF_API_KEY (credential-paste, non-standard auth).",
  },
  {
    id: "codebuddy-cn",
    name: "CodeBuddy CN",
    kind: "oauth",
    category: "oauth",
    baseUrl: "",
    wireFormat: null,
    oauthProvider: "codebuddy-cn",
    deferredReason: "Tencent device-code flow + direct API key (credential-paste, non-standard auth).",
  },
];
