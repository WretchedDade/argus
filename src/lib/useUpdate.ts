import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    api,
    isUpdateRunning,
    updateStatusQuery,
    type UpdatePhase,
} from "./api";
import { pushToast, updateToast } from "./toast";

const PHASE_LABEL: Partial<Record<UpdatePhase, string>> = {
    downloading: "Downloading…",
    verifying: "Verifying…",
    extracting: "Unpacking…",
    installing: "Installing…",
};

// The server runs the update, so this state survives closing the bell. Mount
// `useUpdateToasts` once, in a component that is always on screen.
export function useUpdate() {
    const qc = useQueryClient();
    const status = useQuery(updateStatusQuery).data;
    const start = useMutation({
        mutationFn: () => api.applyUpdate(),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: updateStatusQuery.queryKey }),
        onError: (err) => pushToast(`Update failed: ${err.message}`, "error"),
    });
    return {
        start: start.mutate,
        starting: start.isPending,
        running: start.isPending || isUpdateRunning(status?.phase),
    };
}

// One live toast follows the update: it shows the phase while the update runs,
// then turns into the result. A finished state seen on page load shows nothing.
export function useUpdateToasts() {
    const qc = useQueryClient();
    const status = useQuery(updateStatusQuery).data;
    const toastId = useRef<number | null>(null);

    useEffect(() => {
        const phase = status?.phase;
        if (!phase) return;
        if (isUpdateRunning(phase)) {
            const message = `Updating Argus: ${PHASE_LABEL[phase]}`;
            if (toastId.current === null) {
                toastId.current = pushToast(message, "progress");
            } else {
                updateToast(toastId.current, { message, kind: "progress" });
            }
            return;
        }
        if (toastId.current === null) return;
        if (phase === "done") {
            // Sticky: the user must see the reload step.
            updateToast(
                toastId.current,
                {
                    message: "Update installed. Reload extensions to finish.",
                    kind: "success",
                },
                null,
            );
        } else if (phase === "error") {
            updateToast(
                toastId.current,
                {
                    message: `Update failed: ${status?.error ?? "unknown error"}`,
                    kind: "error",
                },
                6000,
            );
        }
        toastId.current = null;
        void qc.invalidateQueries({ queryKey: ["notices"] });
    }, [status, qc]);
}
