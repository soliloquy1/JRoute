// src/components/dashboard/AddConnectionButton.tsx
"use client";

import { useState } from "react";
import { AddApiKeyModal } from "./AddApiKeyModal.tsx";
import { AddOAuthConnectionModal } from "./AddOAuthConnectionModal.tsx";
import { PrimaryButton, ToastProvider } from "./ui.tsx";
import type { ProviderKind } from "@/lib/db/types.ts";

/** Client wrapper that owns the "add connection" modal open-state for one provider. */
export function AddConnectionButton({
  providerId,
  providerName,
  providerKind,
  oauthProviderKey,
}: {
  providerId: string;
  providerName: string;
  providerKind: ProviderKind;
  oauthProviderKey?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const isOAuth = providerKind === "oauth";
  return (
    <ToastProvider>
      <PrimaryButton onClick={() => setOpen(true)}>
        {isOAuth ? "+ Connect via OAuth" : "+ Add connection"}
      </PrimaryButton>
      {open &&
        (isOAuth ? (
          <AddOAuthConnectionModal
            providerId={providerId}
            providerName={providerName}
            oauthProviderKey={oauthProviderKey ?? providerId}
            onClose={() => setOpen(false)}
          />
        ) : (
          <AddApiKeyModal providerId={providerId} providerName={providerName} onClose={() => setOpen(false)} />
        ))}
    </ToastProvider>
  );
}
