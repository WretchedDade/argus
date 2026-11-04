import {
    DelegateBackoff,
    handleWhen,
    retry,
    type IRetryBackoffContext,
} from "cockatiel";

export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    // Decides whether a failed attempt may run again. Defaults to isTransientError.
    shouldRetry?: (err: unknown) => boolean;
    signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([408, 429]);

function statusOf(err: unknown): number | undefined {
    const status = (err as { status?: unknown } | null)?.status;
    return typeof status === "number" ? status : undefined;
}

export function isTransientStatus(status: number): boolean {
    return RETRYABLE_STATUS.has(status) || status >= 500;
}

// True for failures that can pass on their own: timeouts, network errors, 408, 429, 5xx.
// Auth errors (401) and other 4xx answers are not transient.
export function isTransientError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const status = statusOf(err);
    if (status !== undefined) return isTransientStatus(status);
    if (err.name === "AuthInteractionRequiredError") return false;
    if (err.name === "TimeoutError") return true;
    // Node fetch reports network failures as TypeError("fetch failed"); execFile marks a timeout kill.
    if (err instanceof TypeError) return true;
    return (err as { killed?: unknown }).killed === true;
}

function retryAfterOf(err: unknown): number | undefined {
    const value = (err as { retryAfterMs?: unknown } | null)?.retryAfterMs;
    return typeof value === "number" && value >= 0 ? value : undefined;
}

// Retries `fn` with exponential backoff and full jitter. A Retry-After hint on the error wins.
export function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {},
): Promise<T> {
    const {
        maxAttempts = 3,
        baseDelayMs = 500,
        maxDelayMs = 30_000,
        shouldRetry = isTransientError,
        signal,
    } = options;
    const policy = retry(
        handleWhen((err) => shouldRetry(err)),
        {
            maxAttempts: maxAttempts - 1,
            backoff: new DelegateBackoff(
                (ctx: IRetryBackoffContext<unknown>) => {
                    const hint =
                        "error" in ctx.result
                            ? retryAfterOf(ctx.result.error)
                            : undefined;
                    if (hint !== undefined) return Math.min(hint, maxDelayMs);
                    const ceiling = Math.min(
                        maxDelayMs,
                        baseDelayMs * 2 ** (ctx.attempt - 1),
                    );
                    return Math.random() * ceiling;
                },
            ),
        },
    );
    return policy.execute(() => fn(), signal);
}

// Parses a Retry-After header: delta-seconds or an HTTP date. Returns milliseconds.
export function parseRetryAfter(
    value: string | null,
    now = Date.now(),
): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
