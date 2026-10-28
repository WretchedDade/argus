import { useSyncExternalStore } from "react";
import { Check, X } from "lucide-react";
import { dismissToast, getToasts, subscribeToasts } from "../lib/toast";

export function Toaster() {
    const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
    if (toasts.length === 0) return null;

    return (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
            {toasts.map((t) => (
                <div
                    key={t.id}
                    className="toast-in border-line bg-surface pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg"
                    style={{
                        borderColor:
                            t.kind === "success"
                                ? "color-mix(in srgb, var(--peacock-teal) 55%, var(--color-line))"
                                : "color-mix(in srgb, #d64545 55%, var(--color-line))",
                    }}
                >
                    <span
                        className="flex h-4 w-4 items-center justify-center rounded-full text-white"
                        style={{
                            background:
                                t.kind === "success"
                                    ? "var(--peacock-teal)"
                                    : "#d64545",
                        }}
                    >
                        {t.kind === "success" ? (
                            <Check size={12} />
                        ) : (
                            <X size={12} />
                        )}
                    </span>
                    <span className="text-fg">{t.message}</span>
                    <button
                        type="button"
                        onClick={() => dismissToast(t.id)}
                        className="text-muted hover:text-fg ml-1"
                        aria-label="Dismiss"
                    >
                        <X size={13} />
                    </button>
                </div>
            ))}
        </div>
    );
}
