/**
 * Provider catalog access layer. Re-exports the JRoute-native OpenRouter catalog
 * (do NOT clobber it) and exposes curated catalog queries + partitions for the
 * Providers grid, detail page, and bootstrap seeding.
 */

export {
  getOpenRouterCatalog,
  refreshOpenRouterCatalog,
} from "./openrouterCatalog.ts";

export {
  CATALOG_PROVIDERS,
  DEFERRED_OAUTH_PROVIDERS,
  type CatalogProvider,
  type CatalogCategory,
} from "./providers.ts";

import { CATALOG_PROVIDERS, DEFERRED_OAUTH_PROVIDERS } from "./providers.ts";

/** All catalog entries (shippable + deferred) — the full enumeration. */
export function listAllCatalogProviders() {
  return [...CATALOG_PROVIDERS, ...DEFERRED_OAUTH_PROVIDERS];
}

/** Shippable catalog entries only (wireFormat !== null) — what gets seeded + shown. */
export function listCatalogProviders() {
  return CATALOG_PROVIDERS.filter((p) => p.wireFormat !== null);
}

export function getCatalogProvider(id: string) {
  return CATALOG_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Expressible OAuth providers (kind === "oauth" && wireFormat set). */
export function getExpressibleOAuthProviders() {
  return CATALOG_PROVIDERS.filter((p) => p.kind === "oauth" && p.wireFormat !== null);
}

/** Catalog entries grouped by category for the grid sections. */
export function getCatalogByCategory() {
  const by: Record<string, typeof CATALOG_PROVIDERS> = {
    oauth: [],
    apikey: [],
    compatible: [],
    local: [],
  };
  for (const p of CATALOG_PROVIDERS) {
    if (p.wireFormat === null) continue;
    (by[p.category] ??= []).push(p);
  }
  return by;
}

/**
 * Display category for a REAL `providers` table row (not a catalog entry) — drives the
 * /models page's section grouping. Every catalog provider auto-seeds into `providers`
 * at boot, so this covers both catalog rows and operator-added custom rows: a curated
 * catalog id resolves to its real category (oauth/apikey/local); anything else is an
 * operator-added custom provider (via "Add compatible provider") not in the curated
 * catalog at all — "compatible" by construction, not a guess.
 */
export function categoryForProvider(providerId: string): "oauth" | "apikey" | "compatible" | "local" {
  const catalogEntry = getCatalogProvider(providerId);
  return catalogEntry ? catalogEntry.category : "compatible";
}
