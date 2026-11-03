import { QueryClient } from "@tanstack/react-query";

export const DEFAULT_STALE_TIME_MS = 5_000;
export const SLOW_STALE_TIME_MS = 60_000;

export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: { queries: { staleTime: DEFAULT_STALE_TIME_MS } },
    });
}

// PRs already refreshed since this page loaded.
const refreshedPrs = new Set<string>();

// True once per PR per page load: the caller should then run the refresh.
export function claimPrRefresh(canonical: string): boolean {
    if (refreshedPrs.has(canonical)) return false;
    refreshedPrs.add(canonical);
    return true;
}
