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

> `baseUrl` is the **host + version** root: the executor appends the wire path
> (`/chat/completions`, `/v1/messages`, or the Gemini `buildPath`), so the version segment (e.g.
> `/v1`) MUST be present. Base URLs below are re-derived from
> `open-sse/config/providers/registry/<id>/index.ts`.

| id            | name            | wireFormat | baseUrl                              | oauthProvider  |
| ------------- | --------------- | ---------- | ------------------------------------ | -------------- |
| `claude`      | Claude Code     | anthropic  | `https://api.anthropic.com`          | `claude`       |
| `xai-oauth`   | xAI OAuth (Grok)| openai     | `https://api.x.ai/v1`                | `xai-oauth`    |
| `kimi-coding` | Kimi Code CLI   | openai     | `https://api.moonshot.ai/v1`         | `kimi-coding`  |
| `kilocode`    | Kilo Code       | openai     | `https://api.kilo.ai/api/openrouter` | `kilocode`     |
| `cline`       | Cline           | openai     | `https://api.cline.bot/api/v1`       | `cline`        |
| `clinepass`   | ClinePass       | openai     | `https://api.cline.bot/api/v1`       | `clinepass`    |

> `openference` was removed: it appears in **no** OmniRoute registry and has no real base URL or
> OAuth config, so it was fabricated. Not expressible, not deferred — simply deleted.

## Curated API-key providers (shipped)

`openai`, `anthropic`, `google`, `deepseek`, `groq`, `xai`, `openrouter`. Custom-compatible providers
are added by the operator through the dashboard (Phase 1c `AddCompatibleProviderModal`), not seeded
from the catalog — the previous `custom-*` template rows had an invalid `https://` base URL that
failed `z.uri()` validation and could never be persisted.

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

1. **Expressible vs deferred list** — resolved above (6 expressible OAuth, 18 deferred).
2. **`tokenResolver` injection shape** — injected as an optional parameter into `execute()`
   (`tokenResolver?: (connectionId: number) => string | null`), preserving the testable
   `execute(params, fetchImpl)` signature. No `getDb()` call inside the executor.
3. **Refreshed-token storage** — `src/lib/oauth/refresh.ts` was **dropped from #28**: it had no callers
   and POSTed refresh tokens to guessed hosts (`api.coline.ai`, `api.kilocode.ai`, `api.x.ai/oauth2/token`).
   It lands in **Phase 2**, wired to the executor's 401 path, using the real token endpoints from
   `src/lib/oauth/constants/oauth.ts` (form-encoded body, `client_id`, `AbortSignal` timeout).
4. **`quota_window_thresholds_json` ownership** — lives on `connections` (Phase 0 migration 010);
   `provider_specific_data` is a separate free-form bag on `providers`.
5. **Bootstrap seeding** — `seedCatalogProviders()` (INSERT OR IGNORE on id) runs at first boot in
   `bootstrap.ts`; operator-created/edited rows are never overwritten. Also seeds default models.
6. **Analytics tab scope** — Phase 3 ports only usage / cost / quota tabs; combo / compression /
   search / evals tabs are dropped (depend on excluded subsystems).
