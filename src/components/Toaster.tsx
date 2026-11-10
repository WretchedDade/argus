import { useSyncExternalStore } from "react";
import { Notification, Stack } from "@mantine/core";
import { Check, X } from "lucide-react";
import { dismissToast, getToasts, subscribeToasts } from "../lib/toast";

export function Toaster() {
    const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
    if (toasts.length === 0) return null;
    return (
        <Stack
            gap="xs"
            className="pointer-events-none fixed bottom-4 left-1/2 z-[400] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2"
            aria-live="polite"
            aria-label="Status messages"
        >
            {toasts.map((toast) => (
                <Notification
                    key={toast.id}
                    className="pointer-events-auto"
                    color={toast.kind === "error" ? "red" : undefined}
                    loading={toast.kind === "progress"}
                    icon={
                        toast.kind === "error" ? (
                            <X size={16} />
                        ) : (
                            <Check size={16} />
                        )
                    }
                    withCloseButton={toast.kind !== "progress"}
                    onClose={() => dismissToast(toast.id)}
                    withBorder
                >
                    {toast.message}
                </Notification>
            ))}
        </Stack>
    );
}
