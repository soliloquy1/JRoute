// src/components/dashboard/AddConnectionButton.tsx
"use client";

import { useState } from "react";
import { AddApiKeyModal } from "./AddApiKeyModal.tsx";
import { PrimaryButton, ToastProvider } from "./ui.tsx";

/** Client wrapper that owns the "add connection" modal open-state for one provider. */
export function AddConnectionButton({
  providerId,
  providerName,
}: {
  providerId: string;
  providerName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ToastProvider>
      <PrimaryButton onClick={() => setOpen(true)}>+ Add connection</PrimaryButton>
      {open && (
        <AddApiKeyModal providerId={providerId} providerName={providerName} onClose={() => setOpen(false)} />
      )}
    </ToastProvider>
  );
}
