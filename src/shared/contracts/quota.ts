// `toNumberOrNull` is the canonical coercion (#7879); the local `toNumber` this file used
// to define was byte-for-byte the same shape and is barred by no-restricted-syntax.
import { toNumberOrNull } from "@/shared/utils/numeric";

export type QuotaTokenStatus = "valid" | "expiring" | "expired" | "refreshing";

export interface QuotaProviderEntry {
  name: string;
  provider: string;
  connectionId: string;
  quotaUsed: number;
  quotaTotal: number | null;
  percentRemaining: number;
  resetAt: string | null;
  tokenStatus: QuotaTokenStatus;
}

export interface QuotaResponseMeta {
  generatedAt: string;
  filters: {
    provider: string | null;
    connectionId: string | null;
  };
  totalProviders: number;
}

export interface QuotaResponse {
  providers: QuotaProviderEntry[];
  meta: QuotaResponseMeta;
}

const TOKEN_STATUS_VALUES: QuotaTokenStatus[] = ["valid", "expiring", "expired", "refreshing"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeTokenStatus(value: unknown): QuotaTokenStatus {
  if (typeof value === "string" && TOKEN_STATUS_VALUES.includes(value as QuotaTokenStatus)) {
    return value as QuotaTokenStatus;
  }
  return "valid";
}

export function sanitizeQuotaProvider(input: unknown): QuotaProviderEntry {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const provider = typeof source.provider === "string" ? source.provider : "unknown";
  const name = typeof source.name === "string" && source.name.trim() ? source.name : provider;
  const connectionId =
    typeof source.connectionId === "string" && source.connectionId.trim()
      ? source.connectionId
      : "unknown";

  const quotaTotalRaw = toNumberOrNull(source.quotaTotal);
  const quotaTotal = quotaTotalRaw !== null && quotaTotalRaw >= 0 ? quotaTotalRaw : null;

  const quotaUsedRaw = toNumberOrNull(source.quotaUsed) ?? 0;
  const quotaUsed =
    quotaTotal !== null ? clamp(quotaUsedRaw, 0, quotaTotal) : Math.max(0, quotaUsedRaw);

  let percentRemainingRaw = toNumberOrNull(source.percentRemaining);
  if (percentRemainingRaw === null) {
    if (quotaTotal && quotaTotal > 0) {
      percentRemainingRaw = ((quotaTotal - quotaUsed) / quotaTotal) * 100;
    } else {
      percentRemainingRaw = 100;
    }
  }
  const percentRemaining = clamp(percentRemainingRaw, 0, 100);

  const resetAt =
    typeof source.resetAt === "string" && source.resetAt.trim() ? source.resetAt : null;

  return {
    name,
    provider,
    connectionId,
    quotaUsed,
    quotaTotal,
    percentRemaining,
    resetAt,
    tokenStatus: normalizeTokenStatus(source.tokenStatus),
  };
}

export function normalizeQuotaResponse(
  raw: unknown,
  filters: { provider?: string | null; connectionId?: string | null } = {}
): QuotaResponse {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const providersRaw = Array.isArray(source.providers)
    ? source.providers
    : Array.isArray(raw)
      ? raw
      : [];

  const providers = providersRaw.map((entry) => sanitizeQuotaProvider(entry));

  const sourceMeta =
    source.meta && typeof source.meta === "object" ? (source.meta as Record<string, unknown>) : {};
  const sourceFilters =
    sourceMeta.filters && typeof sourceMeta.filters === "object"
      ? (sourceMeta.filters as Record<string, unknown>)
      : {};

  const providerFilter =
    filters.provider ??
    (typeof sourceFilters.provider === "string" && sourceFilters.provider.trim()
      ? sourceFilters.provider
      : null);
  const connectionFilter =
    filters.connectionId ??
    (typeof sourceFilters.connectionId === "string" && sourceFilters.connectionId.trim()
      ? sourceFilters.connectionId
      : null);

  const generatedAt =
    typeof sourceMeta.generatedAt === "string" && sourceMeta.generatedAt.trim()
      ? sourceMeta.generatedAt
      : new Date().toISOString();

  return {
    providers,
    meta: {
      generatedAt,
      filters: {
        provider: providerFilter || null,
        connectionId: connectionFilter || null,
      },
      totalProviders: providers.length,
    },
  };
}
