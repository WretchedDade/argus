import {
    QueryClient,
    type FetchQueryOptions,
    type QueryKey,
} from "@tanstack/react-query";

export const DEFAULT_STALE_TIME_MS = 5_000;
export const SLOW_STALE_TIME_MS = 60_000;

export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { staleTime: DEFAULT_STALE_TIME_MS, retry: 1 },
        },
    });
}

// Route loaders warm the cache but must not fail the route: each page shows its own error state.
export async function warmQuery<T, K extends QueryKey>(
    qc: QueryClient,
    options: FetchQueryOptions<T, Error, T, K>,
): Promise<void> {
    try {
        await qc.ensureQueryData(options);
    } catch {
        // The page reads the failed query and shows its own error state.
    }
}

// PRs already refreshed since this page loaded.
const refreshedPrs = new Set<string>();

// True once per PR per page load: the caller should then run the refresh.
export function claimPrRefresh(canonical: string): boolean {
    if (refreshedPrs.has(canonical)) return false;
    refreshedPrs.add(canonical);
    return true;
}

// Call after a failed refresh so the next open retries.
export function releasePrRefresh(canonical: string): void {
    refreshedPrs.delete(canonical);
}
