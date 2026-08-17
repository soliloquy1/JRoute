// src/lib/oauth/callbackState.ts
/**
 * In-memory state for the one expressible provider that runs an automated local
 * callback server (xai-oauth). Persisted on `globalThis` so it survives Next.js dev
 * HMR reloads of this module, mirroring OmniRoute's `__pkceCallbackStates` pattern.
 * Single in-flight flow per provider key.
 */
import { startLocalServer } from "./server.ts";

export interface CallbackFlowState {
  close: () => void;
  callbackParams: Record<string, string> | null;
  redirectUri: string;
  codeVerifier: string;
  state: string;
  label: string;
  startedAt: number;
}

declare global {
  var __jrouteOAuthCallbackStates: Record<string, CallbackFlowState> | undefined;
}

function store(): Record<string, CallbackFlowState> {
  if (!globalThis.__jrouteOAuthCallbackStates) globalThis.__jrouteOAuthCallbackStates = {};
  return globalThis.__jrouteOAuthCallbackStates;
}

const AUTO_CLEANUP_MS = 5 * 60 * 1000;

/** Start (or restart) the callback server for `providerKey`. Any prior in-flight
 * flow for the same provider is torn down first. */
export async function startCallbackFlow(
  providerKey: string,
  params: {
    fixedPort: number;
    callbackPath: string;
    callbackHost: string;
    codeVerifier: string;
    state: string;
    label: string;
  }
): Promise<{ port: number; redirectUri: string }> {
  const states = store();
  if (states[providerKey]) {
    try {
      states[providerKey].close();
    } catch {
      /* ignore */
    }
    delete states[providerKey];
  }

  const { port, close } = await startLocalServer((cbParams) => {
    if (states[providerKey]) states[providerKey].callbackParams = cbParams;
  }, params.fixedPort);

  const redirectUri = `http://${params.callbackHost}:${port}${params.callbackPath}`;
  const startedAt = Date.now();
  states[providerKey] = {
    close,
    callbackParams: null,
    redirectUri,
    codeVerifier: params.codeVerifier,
    state: params.state,
    label: params.label,
    startedAt,
  };

  // unref: this is a best-effort safety-net cleanup, not real work — it must not keep
  // the process (or a short-lived test run) alive for up to 5 minutes on its own.
  const cleanupTimer = setTimeout(() => {
    if (states[providerKey]?.startedAt === startedAt) {
      try {
        states[providerKey].close();
      } catch {
        /* ignore */
      }
      delete states[providerKey];
    }
  }, AUTO_CLEANUP_MS);
  cleanupTimer.unref?.();

  return { port, redirectUri };
}

export function getCallbackFlow(providerKey: string): CallbackFlowState | null {
  return store()[providerKey] ?? null;
}

export function clearCallbackFlow(providerKey: string): void {
  const states = store();
  if (!states[providerKey]) return;
  try {
    states[providerKey].close();
  } catch {
    /* ignore */
  }
  delete states[providerKey];
}
