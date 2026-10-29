import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { api, healthQuery } from "../lib/api";

export function AuthControl() {
    const qc = useQueryClient();
    const health = useQuery(healthQuery);
    const auth = health.data?.auth;
    const action = useMutation({
        mutationFn: () => api.signIn(),
        onSuccess: async () => {
            await qc.invalidateQueries();
        },
    });

    if (!auth) return null;
    if (!auth.configured || !auth.supported) {
        return (
            <span
                className="rounded-full border border-red-300/60 bg-red-400/20 px-2 py-0.5 text-xs text-red-100"
                title={auth.error ?? undefined}
            >
                Auth not configured
            </span>
        );
    }

    // Signed in: nothing to show here. Account actions live in Settings.
    if (auth.account && !auth.interactionRequired) return null;

    return (
        <span className="flex items-center gap-2">
            <button
                type="button"
                onClick={() => action.mutate()}
                disabled={action.isPending}
                className="flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-400/20 px-2 py-0.5 text-xs text-amber-100 disabled:opacity-60"
                title={
                    action.error instanceof Error
                        ? action.error.message
                        : (auth.error ?? "Sign in with your Windows account")
                }
            >
                <LogIn size={13} />
                {action.isPending ? "Signing in…" : "Sign in"}
            </button>
            {action.error instanceof Error ? (
                <span
                    className="max-w-72 text-xs text-red-200"
                    title={action.error.message}
                >
                    {action.error.message}
                </span>
            ) : null}
        </span>
    );
}
