import { useState } from "react";

// Wrap an async mutation so callers get a `pending` flag for disabling the
// control and showing a spinner. Guards against concurrent/double invocation.
export function usePending(): {
    pending: boolean;
    run: (fn: () => Promise<void>) => void;
} {
    const [pending, setPending] = useState(false);
    const run = (fn: () => Promise<void>) => {
        if (pending) return;
        setPending(true);
        void fn().finally(() => setPending(false));
    };
    return { pending, run };
}
