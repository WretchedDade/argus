import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { describeLoadFailure, errorMessage } from "../lib/errors";

// Inline banner for a failed query, with an optional retry.
export function ErrorBanner({
    title,
    error,
    onRetry,
}: {
    title: string;
    error?: unknown;
    onRetry?: () => void;
}) {
    return (
        <div
            role="alert"
            className="border-line mb-3 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
            style={{ background: "var(--card-bg)" }}
        >
            <AlertTriangle size={16} className="text-red-500 shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="text-fg font-medium">{title}</div>
                {error !== undefined && (
                    <div className="text-muted truncate text-xs">
                        {errorMessage(error)}
                    </div>
                )}
            </div>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="border-line rounded-md border px-2.5 py-1 text-xs font-semibold"
                >
                    Retry
                </button>
            )}
        </div>
    );
}

// Full-page state for a load failure that leaves the page with nothing to show.
export function LoadErrorPage({
    what,
    error,
    onRetry,
    showActivityLink = true,
}: {
    what: string;
    error: unknown;
    onRetry: () => void;
    showActivityLink?: boolean;
}) {
    const f = describeLoadFailure(error, what);
    return (
        <div
            role="alert"
            className="mx-auto flex max-w-xl flex-col gap-4 py-12"
        >
            <div className="flex items-center gap-3">
                <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                    style={{
                        background:
                            "color-mix(in srgb, var(--color-fg) 8%, transparent)",
                    }}
                >
                    <AlertTriangle size={22} className="text-red-500" />
                </span>
                <h1 className="text-fg text-xl font-semibold tracking-tight">
                    {f.headline}
                </h1>
            </div>
            <p className="text-fg text-sm">{f.reason}</p>
            <div>
                <div className="text-fg mb-1 text-sm font-medium">
                    Things to try
                </div>
                <ul className="text-muted list-disc space-y-1 pl-5 text-sm">
                    {f.steps.map((s) => (
                        <li key={s}>{s}</li>
                    ))}
                </ul>
            </div>
            <div
                className="border-line text-muted rounded-md border px-3 py-2 font-mono text-xs"
                style={{ background: "var(--card-bg)" }}
            >
                {f.technical}
            </div>
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onRetry}
                    className="app-header inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
                >
                    <RefreshCw size={14} />
                    Retry
                </button>
                {showActivityLink && (
                    <Link
                        to="/activity"
                        className="text-muted hover:text-fg text-sm underline"
                    >
                        Open activity log
                    </Link>
                )}
            </div>
        </div>
    );
}

// Shown while a slow route loader runs.
export function PendingPage() {
    return (
        <div className="text-muted flex flex-col items-center justify-center gap-3 py-32 text-sm">
            <Loader2 size={40} className="animate-spin" />
            Loading…
        </div>
    );
}

// Router-level fallback for render and loader errors.
export function RouteError({
    error,
    reset,
}: {
    error: unknown;
    reset: () => void;
}) {
    return (
        <LoadErrorPage
            what="this page"
            error={error}
            onRetry={reset}
            showActivityLink={false}
        />
    );
}
