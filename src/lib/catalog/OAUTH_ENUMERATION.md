# OAuth Provider Enumeration — Expressible vs Deferred

**Source of truth:** `src/lib/catalog/providers.ts` (`CATALOG_PROVIDERS` = shippable, `DEFERRED_OAUTH_PROVIDERS` = deferred).

**Mechanism:** JRoute's engine (`jroute/executor.ts` `WIRE_DESCRIPTORS`) speaks exactly three wire
formats — `openai` (`authorization: Bearer`), `anthropic` (`x-api-key` + `anthropic-version`),
`gemini` (`x-goog-api-key`). The OmniRoute `open-sse` combo/routing engine and its 248-entry
registry are **not** ported. Therefore an OAuth provider is only *expressible* (and thus seeded as a
catalog row) when it maps to one of those three wire formats **and** a bearer token — i.e. no
bespoke request signing, RPC, or desktop-local credential store.

`wireFormat: null` ⇒ **deferred**: documented here (the Phase 0 gate) but intentionally NOT seeded
into `providers`, so we never ship a dead row JRoute cannot proxy.

## Expressible OAuth (shipped as catalog rows)

| id            | name            | wireFormat | baseUrl                              | oauthProvider  |
| ------------- | --------------- | ---------- | ------------------------------------ | -------------- |
| `claude`      | Claude Code     | anthropic  | `https://api.anthropic.com`          | `claude`       |
| `xai-oauth`   | xAI OAuth (Grok)| openai     | `https://api.x.ai`                   | `xai-oauth`    |
| `openference` | Openference     | openai     | `https://api.openference.com`        | `openference`  |
| `kimi-coding` | Kimi Code CLI   | openai     | `https://api.moonshot.cn/v1`         | `kimi-coding`  |
| `kilocode`    | Kilo Code       | openai     | `https://api.kilocode.ai/v1`         | `kilocode`     |
| `cline`       | Cline           | openai     | `https://api.coline.ai/v1`           | `cline`        |
| `clinepass`   | ClinePass       | openai     | `https://api.coline.ai/v1`           | `clinepass`    |

## Curated API-key providers (shipped)

`openai`, `anthropic`, `google`, `deepseek`, `groq`, `xai`, `openrouter`, plus custom-compatible
templates `custom-openai` / `custom-anthropic` / `custom-gemini` (operator supplies `baseUrl` + key).

## Deferred OAuth (documented, NOT shipped)

| id               | name                     | reason (why not expressible)                                                                 |
| ---------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `ghe-copilot`    | GitHub Enterprise Copilot| Copilot token exchange + enterprise instance URL + bespoke GitHub Copilot headers.           |
| `grok-cli`       | Grok Build               | `cli-chat-proxy.grok.com` / grok-build JWT sessions via Grok Build CLI (bespoke).            |
| `qoder`          | Qoder                    | `QoderExecutor` (bespoke request signing/RPC).                                               |
| `agy`            | Antigravity CLI          | `AntigravityExecutor` (bespoke).                                                              |
| `kiro`           | Kiro AI                  | `KiroExecutor` + desktop `kiro://` protocol (bespoke + desktop-local).                       |
| `amazon-q`       | Amazon Q                 | AWS Builder ID / refresh-token flow shared with Kiro (bespoke).                              |
| `antigravity`    | Antigravity              | `AntigravityExecutor` (bespoke).                                                             |
| `codex`          | OpenAI Codex             | `CodexExecutor` (bespoke request signing/RPC).                                               |
| `github`         | GitHub Copilot           | `GithubExecutor` (bespoke Copilot token exchange + headers).                                 |
| `gitlab-duo`     | GitLab Duo               | GitLab Duo OAuth (PAT/exchange) not mappable to a single wire+bearer (bespoke).              |
| `cursor`         | Cursor IDE               | `CursorExecutor` — protobuf RPC `agent.v1.AgentService/Run` (bespoke).                       |
| `zed`            | Zed IDE                  | Credentials imported from the OS keychain (desktop-local) — not a server OAuth flow.        |
| `zed-hosted`     | Zed Hosted Models        | Native-app sign-in with one-time RSA keypair (bespoke).                                      |
| `trae`           | Trae                     | `Cloud-IDE-JWT` header (`Authorization: Cloud-IDE-JWT <token>`) — non-standard auth header.  |
| `raycast`        | Raycast Pro AI           | macOS app sqlite credential capture (desktop-local) — excluded from shipped set entirely.    |
| `devin-desktop`  | Devin Desktop            | Pasted Devin API key (credential-paste, non-standard auth).                                  |
| `devin-cli`      | Devin CLI                | Requires Devin CLI binary / `WINDSURF_API_KEY` (credential-paste, non-standard auth).        |
| `codebuddy-cn`   | CodeBuddy CN             | Tencent device-code flow + direct API key (credential-paste, non-standard auth).             |

## Open questions resolved

1. **Expressible vs deferred list** — resolved above (7 expressible OAuth, 18 deferred).
2. **`tokenResolver` injection shape** — injected as an optional parameter into `execute()`
   (`tokenResolver?: (connectionId: number) => string | null`), preserving the testable
   `execute(params, fetchImpl)` signature. No `getDb()` call inside the executor.
3. **Refreshed-token storage** — written (encrypted) back to `oauth_tokens` by `src/lib/oauth/refresh.ts`
   (Phase 2). Supports providers whose OAuth flow returns a refresh token (all expressible ones).
4. **`quota_window_thresholds_json` ownership** — lives on `connections` (Phase 0 migration 010);
   `provider_specific_data` is a separate free-form bag on `providers`.
5. **Bootstrap seeding** — `seedCatalogProviders()` (INSERT OR IGNORE on id) runs at first boot in
   `bootstrap.ts`; operator-created/edited rows are never overwritten. Also seeds default models.
6. **Analytics tab scope** — Phase 3 ports only usage / cost / quota tabs; combo / compression /
   search / evals tabs are dropped (depend on excluded subsystems).
