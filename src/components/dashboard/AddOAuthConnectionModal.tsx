// src/components/dashboard/AddOAuthConnectionModal.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, PrimaryButton, GhostButton, Field, inputClass, InlineError, useToast } from "./ui.tsx";
import { oauthUiFlowKind } from "@/lib/oauth/flowKind.ts";

type Step = "label" | "waiting" | "paste-code";

interface AuthorizeData {
  authUrl: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
}

interface DeviceCodeData {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      typeof body?.error === "string" ? body.error : body?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

/**
 * OAuth connect flow for expressible providers (claude, xai-oauth, kimi-coding,
 * kilocode, cline, clinepass) — three shapes driven by `oauthUiFlowKind`:
 * paste-a-code, automated local-loopback callback, or device-code polling.
 */
export function AddOAuthConnectionModal({
  providerId,
  providerName,
  oauthProviderKey,
  onClose,
}: {
  providerId: string;
  providerName: string;
  oauthProviderKey: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const flowKind = oauthUiFlowKind(oauthProviderKey);

  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("label");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [authorizeData, setAuthorizeData] = useState<AuthorizeData | null>(null);
  const [pasteCode, setPasteCode] = useState("");

  const [deviceData, setDeviceData] = useState<DeviceCodeData | null>(null);

  const cancelledRef = useRef(false);
  useEffect(() => () => {
    cancelledRef.current = true;
  }, []);

  function finish() {
    toast("Connected", "ok");
    onClose();
    router.refresh();
  }

  async function pollLoopback(intervalMs = 2000, deadline = Date.now() + POLL_TIMEOUT_MS) {
    if (cancelledRef.current) return;
    if (Date.now() > deadline) {
      setError("Timed out waiting for the browser callback.");
      setBusy(false);
      return;
    }
    try {
      const result = await fetchJson<{ success: boolean; pending?: boolean; error?: string; errorDescription?: string }>(
        `/api/oauth/${providerId}/poll-callback`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
      );
      if (result.success) {
        finish();
        return;
      }
      if (result.pending) {
        setTimeout(() => pollLoopback(intervalMs, deadline), intervalMs);
        return;
      }
      setError(result.errorDescription || result.error || "Authorization failed");
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  async function pollDevice(deviceCode: string, intervalMs: number, deadline: number) {
    if (cancelledRef.current) return;
    if (Date.now() > deadline) {
      setError("Timed out waiting for authorization.");
      setBusy(false);
      return;
    }
    try {
      const result = await fetchJson<{ success: boolean; pending?: boolean; error?: string; errorDescription?: string }>(
        `/api/oauth/${providerId}/poll`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceCode, label: label.trim() }),
        }
      );
      if (result.success) {
        finish();
        return;
      }
      if (result.pending) {
        setTimeout(() => pollDevice(deviceCode, intervalMs, deadline), intervalMs);
        return;
      }
      setError(result.errorDescription || result.error || "Authorization failed");
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = label.trim();
    if (!trimmed) {
      setLabelError("Label is required");
      return;
    }
    setLabelError(null);
    setError(null);
    setBusy(true);

    try {
      if (flowKind === "authorize_paste") {
        const data = await fetchJson<AuthorizeData>(`/api/oauth/${providerId}/authorize`);
        setAuthorizeData(data);
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
        setStep("paste-code");
        setBusy(false);
      } else if (flowKind === "loopback") {
        const data = await fetchJson<{ authUrl: string }>(
          `/api/oauth/${providerId}/start-callback-server?label=${encodeURIComponent(trimmed)}`
        );
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
        setStep("waiting");
        pollLoopback();
      } else if (flowKind === "device_code") {
        const data = await fetchJson<DeviceCodeData>(`/api/oauth/${providerId}/device-code`);
        setDeviceData(data);
        window.open(data.verificationUriComplete, "_blank", "noopener,noreferrer");
        setStep("waiting");
        pollDevice(data.deviceCode, (data.interval || 5) * 1000, Date.now() + data.expiresIn * 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !authorizeData) return;
    if (!pasteCode.trim()) {
      setError("Paste the code from the browser tab");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await fetchJson(`/api/oauth/${providerId}/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: pasteCode.trim(),
          redirectUri: authorizeData.redirectUri,
          codeVerifier: authorizeData.codeVerifier,
          state: authorizeData.state,
          label: label.trim(),
        }),
      });
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Connect via OAuth · ${providerName}`}
      footer={
        step === "label" ? (
          <div className="flex justify-end gap-2">
            <GhostButton type="button" onClick={onClose}>
              Cancel
            </GhostButton>
            <PrimaryButton type="submit" form="oauth-start-form" disabled={busy}>
              {busy ? "Starting…" : "Connect"}
            </PrimaryButton>
          </div>
        ) : step === "paste-code" ? (
          <div className="flex justify-end gap-2">
            <GhostButton type="button" onClick={onClose}>
              Cancel
            </GhostButton>
            <PrimaryButton type="submit" form="oauth-paste-form" disabled={busy}>
              {busy ? "Connecting…" : "Submit code"}
            </PrimaryButton>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <GhostButton type="button" onClick={onClose}>
              Cancel
            </GhostButton>
          </div>
        )
      }
    >
      {step === "label" && (
        <form id="oauth-start-form" onSubmit={onStart} className="flex flex-col gap-3">
          <Field label="Label">
            <input
              className={inputClass}
              placeholder="primary"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <InlineError message={labelError} />
          <p className="text-xs text-text-muted">
            Opens {providerName}&apos;s sign-in page in a new tab. Complete the login there, then
            come back here.
          </p>
          <InlineError message={error} />
        </form>
      )}

      {step === "paste-code" && (
        <form id="oauth-paste-form" onSubmit={onSubmitCode} className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">
            After finishing the login in the opened tab, paste the resulting code below.
          </p>
          <Field label="Code">
            <input
              className={`${inputClass} font-mono text-[13px]`}
              autoComplete="off"
              value={pasteCode}
              onChange={(e) => setPasteCode(e.target.value)}
            />
          </Field>
          <InlineError message={error} />
        </form>
      )}

      {step === "waiting" && (
        <div className="flex flex-col gap-3">
          {deviceData ? (
            <>
              <p className="text-xs text-text-muted">
                Enter this code at the verification page (opened in a new tab):
              </p>
              <div className="rounded-control border border-border-strong bg-bg-subtle px-3 py-2 text-center font-mono text-lg tracking-widest">
                {deviceData.userCode}
              </div>
            </>
          ) : (
            <p className="text-xs text-text-muted">Waiting for the browser tab to complete sign-in…</p>
          )}
          <InlineError message={error} />
        </div>
      )}
    </Modal>
  );
}
