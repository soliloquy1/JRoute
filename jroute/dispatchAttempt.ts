// jroute/dispatchAttempt.ts
//
// Connection-dispatch-with-failover, extracted verbatim from `handleChat.ts` so a second
// call site (native tool-calling mode's per-round dispatch, `src/lib/mcp/loop.ts`) can reuse
// it. This is a PURE EXTRACTION: the candidate resolution, decrypt-failure skipping, OAuth
// 401 refresh-then-retry, cooldown marking, per-dial quota recording, client-hangup
// detection and failure-message resolution below are byte-for-byte the logic that lived
// inline in `handleChat.ts`, including its debug-log event names and its comments. Behavior
// is relocated, not improved — any real improvement belongs in its own reviewed change.
import type { Provider } from "../src/lib/db/types.ts";
import { listConnections, markCooldown, clearCooldown } from "../src/lib/db/connections.ts";
import { recordUsage, parseQuotaThresholds, isOverQuota } from "../src/lib/db/quotaWindows.ts";
import { getOAuthToken } from "../src/lib/db/oauthTokens.ts";
import { oauthTokenKey } from "../src/lib/oauth/tokenKey.ts";
import { refreshOAuthToken } from "../src/lib/oauth/refresh.ts";
import { eligibleConnections, applyFallbackStrategy } from "./selectConnection.ts";
import { getFallbackStrategy } from "../src/lib/db/settings.ts";
import { getLastConnectionId, setLastConnectionId } from "../src/lib/db/providerRoutingState.ts";
import { execute, cooldownMsFor, type ExecuteResult } from "./executor.ts";
import { debugLog, debugLogError } from "../src/lib/debugLog/logger.ts";

export interface DispatchParams {
  provider: Provider;
  providerId: string;
  upstreamModel: string;
  upstreamBody: Record<string, unknown>;
  clientWantsStream: boolean;
  signal: AbortSignal;
  tokenResolver: (connectionId: number) => string | null;
  requestId: string;
  fetchImpl: typeof fetch;
}

export interface DispatchSuccess {
  ok: true;
  connectionId: number;
  windowMs: number;
  result: ExecuteResult;
}

export interface DispatchFailure {
  ok: false;
  /** True means: return `new Response(null, { status: 499 })`, no logUsage row. */
  clientAborted: boolean;
  /**
   * True when no connection was even eligible to dial. `handleChat.ts` has always answered
   * this case with a bare `jsonError(503, "No available connection")` — no `response.failure`
   * debug line and no `usage_logs` row — distinct from the post-attempt failure path below,
   * which writes both. Preserved as its own flag so the extraction does not silently start
   * writing an error row (and skewing the dashboard's error stats) for a request that never
   * reached an upstream.
   */
  noCandidates: boolean;
  status: number;
  message: string;
  connectionId: number | null;
  skippedDecryptFailed: boolean;
}

export type DispatchOutcome = DispatchSuccess | DispatchFailure;

export async function dispatchWithFailover(params: DispatchParams): Promise<DispatchOutcome> {
  const {
    provider,
    providerId,
    upstreamModel,
    upstreamBody,
    clientWantsStream,
    signal,
    tokenResolver,
    requestId,
    fetchImpl,
  } = params;

  const fallbackStrategy = getFallbackStrategy();
  const candidates = applyFallbackStrategy(
    eligibleConnections(listConnections(providerId), Date.now(), isOverQuota),
    fallbackStrategy,
    providerId,
    getLastConnectionId
  );
  debugLog("connections.eligible", {
    requestId,
    providerId,
    candidateCount: candidates.length,
    candidateIds: candidates.map((c) => c.id),
  });
  if (candidates.length === 0) {
    return {
      ok: false,
      clientAborted: false,
      noCandidates: true,
      status: 503,
      message: "No available connection",
      connectionId: null,
      skippedDecryptFailed: false,
    };
  }

  // A real upstream attempt and a skipped-before-dialling connection are tracked
  // SEPARATELY. Sharing one `lastMessage` let a decrypt-failed connection sitting
  // *behind* a genuinely failing one rewrite the failure story: the status stayed the
  // real 503 while the message became "credential could not be decrypted", so the
  // response and the `usage_logs` row Plan 7's dashboard reads both recorded the wrong
  // cause. The credential reason is only surfaced when no real attempt ever produced one.
  let lastStatus: number | null = null;
  let lastMessage: string | null = null;
  let lastConnectionId: number | null = null;
  let skippedDecryptFailed = false;
  // Phase 2: at most one refresh-then-retry per connection per request — prevents an
  // upstream that keeps returning 401 even with a fresh token from looping forever.
  const oauthRefreshedConnectionIds = new Set<number>();

  for (let attempt = 0; attempt < candidates.length; attempt += 1) {
    const connection = candidates[attempt];

    // The connection's configured quota window length (Phase 2 fix): recordUsage must
    // bucket into the SAME windowMs that isOverQuota reads, or a non-60s threshold never
    // trips. Falls back to the 60s default when unset/garbage.
    const windowMs = parseQuotaThresholds(connection.quotaWindowThresholds).windowMs ?? 60_000;

    // Operator addition B: skip connections whose credential could not be decrypted.
    // This is a config problem (rotated/lost STORAGE_ENCRYPTION_KEY), not a connection
    // health issue. Do not cool down — just skip and let healthy connections behind it
    // get their turn. If every candidate is in this state, the operator gets the
    // distinct "could not be decrypted" reason rather than a generic upstream failure.
    if (connection.credentialDecryptFailed) {
      skippedDecryptFailed = true;
      debugLog("connection.skipped_decrypt_failed", { requestId, connectionId: connection.id });
      continue;
    }

    // Same skip, for the oauth_tokens ciphertext (bug #6148 class): without this, a
    // decrypt-failed token silently resolves to null in tokenResolver and the executor
    // fires with an empty bearer — a blind 401 that looks like a real auth failure
    // instead of the operator-fixable "STORAGE_ENCRYPTION_KEY changed" cause.
    if (provider.kind === "oauth") {
      const tokenRow = getOAuthToken(oauthTokenKey(provider), connection.id);
      if (tokenRow?.credentialDecryptFailed) {
        skippedDecryptFailed = true;
        debugLog("connection.skipped_oauth_decrypt_failed", {
          requestId,
          connectionId: connection.id,
        });
        continue;
      }
    }

    debugLog("upstream.attempt", {
      requestId,
      attempt,
      connectionId: connection.id,
      connectionLabel: connection.label,
      providerId,
    });

    const result = await execute(
      {
        provider,
        connection,
        body: upstreamBody,
        signal,
        model: upstreamModel,
        // The stream flag comes from the CLIENT request body, NOT from `upstreamBody`: the
        // Gemini converter strips `stream` from the converted body (streaming is a URL concern
        // there), so `upstreamBody.stream` is always undefined and the streaming URL would
        // never be selected. `clientWantsStream` here is the caller's pre-conversion flag.
        stream: clientWantsStream,
        tokenResolver,
      },
      fetchImpl
    );

    // Phase 3/4: attribute this upstream attempt to the connection's rolling quota
    // window (1 request per dial; tokens are added once known by the caller). Failed
    // attempts (e.g. 429) also consume the provider's limit, so they count too. Wrapped in
    // try/catch: with foreign_keys=ON a stale/ghost connection id can throw inside the
    // stream-completion callback, and a throw here must not abort the failover loop.
    try {
      recordUsage(connection.id, 1, 0, Date.now(), windowMs);
    } catch (err) {
      debugLogError("quota.record_failed", { connectionId: connection.id, error: String(err) });
    }

    debugLog("upstream.result", {
      requestId,
      attempt,
      connectionId: connection.id,
      ok: result.ok,
      status: result.status,
      errorMessage: result.errorMessage,
      retryable: result.retryable,
      isStream: result.stream !== null,
    });

    // Operator addition A: honor the client-hangup contract.
    // Executor signals an abort as status === 0 AND errorMessage === null.
    // A genuine transport failure is status === 0 with a non-null errorMessage and
    // retryable: true. For an abort we must NOT write a usage row claiming an upstream
    // error (it would corrupt dashboard error stats), must NOT cool down the connection
    // (the upstream may be perfectly healthy), and must NOT fail over.
    if (result.status === 0 && result.errorMessage === null) {
      debugLog("request.client_aborted", { requestId, attempt, connectionId: connection.id });
      return {
        ok: false,
        clientAborted: true,
        noCandidates: false,
        status: 0,
        message: "",
        connectionId: connection.id,
        skippedDecryptFailed,
      };
    }

    if (result.ok) {
      clearCooldown(connection.id);
      // Phase 4: only the round-robin strategy consults this cursor (selectConnection.ts's
      // applyFallbackStrategy), so only bother writing it under that strategy.
      if (fallbackStrategy === "round-robin") {
        setLastConnectionId(providerId, connection.id);
      }
      return { ok: true, connectionId: connection.id, windowMs, result };
    }

    // Phase 2: an oauth connection's 401 usually means the access token expired
    // between our (skew-tolerant) validity check and the actual dial. Refresh once and
    // retry the SAME connection before falling over to the next candidate — 429 is
    // unaffected and keeps using the existing markCooldown path below.
    if (result.status === 401 && provider.kind === "oauth") {
      if (!oauthRefreshedConnectionIds.has(connection.id)) {
        oauthRefreshedConnectionIds.add(connection.id);
        const refreshed = await refreshOAuthToken(provider, connection.id);
        if (refreshed) {
          debugLog("oauth.token_refreshed_retry", { requestId, connectionId: connection.id });
          attempt -= 1;
          continue;
        }
        debugLog("oauth.refresh_failed", { requestId, connectionId: connection.id });
      }
      // Refresh was already attempted (or just failed): this connection's credential
      // is bad, but sibling connections for the same provider may still work — fail
      // over instead of the generic "break on non-retryable status" path below, since
      // a bare 401 is not in the executor's RETRYABLE set.
      lastStatus = result.status || 502;
      lastMessage = result.errorMessage ?? "Upstream error";
      lastConnectionId = connection.id;
      markCooldown(
        connection.id,
        Date.now() + cooldownMsFor(result.status, attempt, result.retryAfterMs),
        lastMessage
      );
      continue;
    }

    lastStatus = result.status || 502;
    lastMessage = result.errorMessage ?? "Upstream error";
    // Attribute the failure row to the connection that actually produced it, so the
    // dashboard can answer "which key is 503-ing" instead of just "something failed".
    lastConnectionId = connection.id;

    if (!result.retryable) break;
    markCooldown(
      connection.id,
      Date.now() + cooldownMsFor(result.status, attempt, result.retryAfterMs),
      lastMessage
    );
  }

  // A real attempt's outcome always wins. The credential reason is the fallback only
  // when every candidate was skipped before a request was ever sent.
  return {
    ok: false,
    clientAborted: false,
    noCandidates: false,
    status: lastStatus ?? 502,
    message:
      lastMessage ??
      (skippedDecryptFailed
        ? "Connection credential could not be decrypted"
        : "All connections failed"),
    connectionId: lastConnectionId,
    skippedDecryptFailed,
  };
}
