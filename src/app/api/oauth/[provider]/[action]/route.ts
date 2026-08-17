// src/app/api/oauth/[provider]/[action]/route.ts
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getProvider } from "@/lib/db/providers.ts";
import type { Provider } from "@/lib/db/types.ts";
import { getOAuthProvider, isOAuthProviderKey } from "@/lib/oauth/providers/index.ts";
import { generateAuthData, exchangeTokens, requestDeviceCode, pollForToken } from "@/lib/oauth/flow.ts";
import { generatePKCE } from "@/lib/oauth/pkce.ts";
import { persistOAuthConnection } from "@/lib/oauth/persist.ts";
import { oauthTokenKey } from "@/lib/oauth/tokenKey.ts";
import { startCallbackFlow, getCallbackFlow, clearCallbackFlow } from "@/lib/oauth/callbackState.ts";
import { oauthUiFlowKind } from "@/lib/oauth/flowKind.ts";

/**
 * Trimmed port of OmniRoute's `src/app/api/oauth/[provider]/[action]/route.ts`,
 * covering only the 6 expressible providers (Phase 0 enumeration). Three flow
 * shapes:
 *   - authorize + exchange (claude, cline, clinepass): browser flow with a fixed /
 *     manual redirect, code pasted back by the operator.
 *   - start-callback-server + poll-callback (xai-oauth): automated local loopback
 *     callback server.
 *   - device-code + poll (kimi-coding, kilocode): RFC-8628-shaped device flow.
 */

/** Constant-time string comparison (CWE-208) for the PKCE state check. */
function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a === b;
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function json200(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requireOAuthProvider(providerId: string): Provider | null {
  const provider = getProvider(providerId);
  if (!provider || provider.kind !== "oauth") return null;
  if (!isOAuthProviderKey(oauthTokenKey(provider))) return null;
  return provider;
}

interface LoopbackHandler {
  config: unknown;
  fixedPort: number;
  callbackPath: string;
  callbackHost: string;
  pkceVerifierBytes?: number;
  buildAuthUrl(config: unknown, redirectUri: string, state: string, codeChallenge: string): string;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string; action: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { provider: providerId, action } = await params;
    const provider = requireOAuthProvider(providerId);
    if (!provider) return jsonError(400, "Unknown OAuth provider");
    const key = oauthTokenKey(provider);
    const { searchParams } = new URL(req.url);

    if (action === "authorize") {
      if (oauthUiFlowKind(key) !== "authorize_paste") {
        return jsonError(400, `authorize not supported for ${key}`);
      }
      const redirectUri = searchParams.get("redirect_uri") || "http://localhost:8080/callback";
      const authData = generateAuthData(key, redirectUri);
      return json200(authData);
    }

    if (action === "device-code") {
      if (oauthUiFlowKind(key) !== "device_code") {
        return jsonError(400, `device code flow not supported for ${key}`);
      }
      const data = await requestDeviceCode(key);
      return json200(data);
    }

    if (action === "start-callback-server") {
      if (oauthUiFlowKind(key) !== "loopback") {
        return jsonError(400, `callback server not supported for ${key}`);
      }
      const label = searchParams.get("label")?.trim();
      if (!label) return jsonError(400, "label is required");

      const handler = getOAuthProvider(key) as unknown as LoopbackHandler;
      const pkce = generatePKCE(handler.pkceVerifierBytes ?? 32);
      const { port, redirectUri } = await startCallbackFlow(key, {
        fixedPort: handler.fixedPort,
        callbackPath: handler.callbackPath,
        callbackHost: handler.callbackHost,
        codeVerifier: pkce.codeVerifier,
        state: pkce.state,
        label,
      });
      const authUrl = handler.buildAuthUrl(handler.config, redirectUri, pkce.state, pkce.codeChallenge);
      return json200({ authUrl, redirectUri, serverPort: port });
    }

    return jsonError(400, "Unknown action");
  } catch (err) {
    console.error("[api/oauth] GET error:", err);
    return jsonError(500, "Internal error");
  }
}

const ExchangeSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().optional(),
  codeVerifier: z.string().optional(),
  state: z.string().optional(),
  label: z.string().min(1),
});

const PollSchema = z.object({
  deviceCode: z.string().min(1),
  label: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string; action: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { provider: providerId, action } = await params;
    const provider = requireOAuthProvider(providerId);
    if (!provider) return jsonError(400, "Unknown OAuth provider");
    const key = oauthTokenKey(provider);

    if (action === "exchange") {
      if (oauthUiFlowKind(key) !== "authorize_paste") {
        return jsonError(400, `exchange not supported for ${key}`);
      }
      const parsed = ExchangeSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return jsonError(400, "Invalid request body");
      const { code, redirectUri, codeVerifier, state, label } = parsed.data;
      const handler = getOAuthProvider(key);
      if (handler.flowType === "authorization_code_pkce" && !codeVerifier) {
        return jsonError(400, `codeVerifier is required for ${key} OAuth exchange`);
      }
      try {
        const mapped = await exchangeTokens(key, code, redirectUri ?? "", codeVerifier ?? "", state ?? "");
        const connectionId = persistOAuthConnection(provider, label, mapped);
        return json200({ success: true, connectionId });
      } catch (err) {
        return jsonError(502, err instanceof Error ? err.message : String(err));
      }
    }

    if (action === "poll") {
      if (oauthUiFlowKind(key) !== "device_code") {
        return jsonError(400, `poll not supported for ${key}`);
      }
      const parsed = PollSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return jsonError(400, "Invalid request body");
      const { deviceCode, label } = parsed.data;
      const result = await pollForToken(key, deviceCode);
      if (result.success && result.tokens) {
        const connectionId = persistOAuthConnection(provider, label, result.tokens);
        return json200({ success: true, connectionId });
      }
      return json200({
        success: false,
        pending: Boolean(result.pending),
        error: result.error,
        errorDescription: result.errorDescription,
      });
    }

    if (action === "poll-callback") {
      if (oauthUiFlowKind(key) !== "loopback") {
        return jsonError(400, `poll-callback not supported for ${key}`);
      }
      const flow = getCallbackFlow(key);
      if (!flow) {
        return json200({ success: false, error: "no_server", errorDescription: "Callback server not running" });
      }
      if (!flow.callbackParams) return json200({ success: false, pending: true });

      const cbParams = flow.callbackParams;
      const { redirectUri, codeVerifier, state, label } = flow;
      clearCallbackFlow(key);

      if (cbParams.error) {
        return json200({ success: false, error: cbParams.error, errorDescription: cbParams.error_description });
      }
      if (!cbParams.code) {
        return json200({ success: false, error: "no_code", errorDescription: "No authorization code received" });
      }
      if (!safeEqual(cbParams.state, state)) {
        return json200({ success: false, error: "invalid_state", errorDescription: "OAuth state mismatch" });
      }

      try {
        const mapped = await exchangeTokens(key, cbParams.code, redirectUri, codeVerifier, cbParams.state);
        const connectionId = persistOAuthConnection(provider, label, mapped);
        return json200({ success: true, connectionId });
      } catch (err) {
        return jsonError(502, err instanceof Error ? err.message : String(err));
      }
    }

    return jsonError(400, "Unknown action");
  } catch (err) {
    console.error("[api/oauth] POST error:", err);
    return jsonError(500, "Internal error");
  }
}
