// src/components/dashboard/AddProviderButton.tsx
"use client";

import { useState } from "react";
import { AddCompatibleProviderModal } from "./AddCompatibleProviderModal.tsx";
import { PrimaryButton, ToastProvider } from "./ui.tsx";

/** Client wrapper that owns the "add compatible provider" modal open-state. */
export function AddProviderButton({ existingIds }: { existingIds: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <ToastProvider>
      <PrimaryButton onClick={() => setOpen(true)}>Add provider</PrimaryButton>
      {open && <AddCompatibleProviderModal existingIds={existingIds} onClose={() => setOpen(false)} />}
    </ToastProvider>
  );
}
