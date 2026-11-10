import { Badge, Button, Text } from "@mantine/core";
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
            await Promise.all([
                qc.invalidateQueries({ queryKey: ["auth"] }),
                qc.invalidateQueries({ queryKey: ["health"] }),
                // Sign-in can reset the backfilled identity stored in config.
                qc.invalidateQueries({ queryKey: ["config"] }),
            ]);
        },
    });

    if (!auth) return null;
    if (!auth.configured || !auth.supported) {
        return (
            <Badge color="red" variant="light" title={auth.error ?? undefined}>
                Auth not configured
            </Badge>
        );
    }

    // Signed in: nothing to show here. Account actions live in Settings.
    if (auth.account && !auth.interactionRequired) return null;

    return (
        <span className="flex items-center gap-2">
            <Button
                variant="default"
                type="button"
                onClick={() => action.mutate()}
                disabled={action.isPending}

                title={
                    action.error instanceof Error
                        ? action.error.message
                        : (auth.error ?? "Sign in with your Windows account")
                }
            >
                <LogIn size={13} />
                {action.isPending ? "Signing in…" : "Sign in"}
            </Button>
            {action.error instanceof Error ? (
                <Text size="xs" c="red" maw={288} title={action.error.message}>
                    {action.error.message}
                </Text>
            ) : null}
        </span>
    );
}
