// src/components/dashboard/providerFormValidation.ts
// Pure, framework-free validation for the provider/connection add modals. Kept out of the
// .tsx components so it can be unit-tested under `npm test` (node:test) without rendering.

export const PROVIDER_ID_RE = /^[a-z0-9-]+$/;
export const MODEL_PREFIX_RE = /^[a-z0-9]*$/;

export interface AddCompatibleProviderValues {
  id: string;
  name: string;
  baseUrl: string;
  wireFormat: "openai" | "anthropic" | "gemini";
  modelPrefix: string;
}

/** Returns a map of field → error message. Empty map ⇒ valid. */
export function validateAddCompatibleProvider(
  values: AddCompatibleProviderValues,
  existingIds: string[]
): Partial<Record<keyof AddCompatibleProviderValues, string>> {
  const errors: Partial<Record<keyof AddCompatibleProviderValues, string>> = {};

  const id = values.id.trim();
  if (!id) {
    errors.id = "Provider id is required";
  } else if (!PROVIDER_ID_RE.test(id)) {
    errors.id = "Id must be lowercase letters, digits, or dashes (a-z0-9-)";
  } else if (existingIds.includes(id)) {
    errors.id = "A provider with this id already exists";
  }

  if (!values.name.trim()) errors.name = "Display name is required";

  if (!values.baseUrl.trim()) {
    errors.baseUrl = "Base URL is required";
  } else {
    try {
      const u = new URL(values.baseUrl.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        errors.baseUrl = "Base URL must start with http(s)://";
      }
    } catch {
      errors.baseUrl = "Base URL must be a valid http(s) URL";
    }
  }

  if (values.modelPrefix && !MODEL_PREFIX_RE.test(values.modelPrefix)) {
    errors.modelPrefix = "Prefix must be empty or lowercase letters/digits";
  }

  return errors;
}

export interface AddApiKeyValues {
  label: string;
  apiKey: string;
  priority: string;
}

export function validateAddApiKey(
  values: AddApiKeyValues
): Partial<Record<keyof AddApiKeyValues, string>> {
  const errors: Partial<Record<keyof AddApiKeyValues, string>> = {};
  if (!values.label.trim()) errors.label = "Label is required";
  if (!values.apiKey.trim()) errors.apiKey = "API key is required";
  if (values.priority.trim() !== "") {
    const n = Number(values.priority);
    if (!Number.isInteger(n) || n < 0) errors.priority = "Priority must be a non-negative integer";
  }
  return errors;
}
