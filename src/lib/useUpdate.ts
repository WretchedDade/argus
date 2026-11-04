import { useEffect } from "react";
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

// The start mutation and the status observer share this one live toast.
let liveToast: number | null = null;

function showPhase(message: string): void {
    if (liveToast === null) liveToast = pushToast(message, "progress");
    else updateToast(liveToast, { message, kind: "progress" });
}

// The server runs the update, so this state survives closing the bell. Mount
// `useUpdateToasts` once, in a component that is always on screen.
export function useUpdate() {
    const qc = useQueryClient();
    const status = useQuery(updateStatusQuery).data;
    const start = useMutation({
        mutationFn: () => api.applyUpdate(),
        onSuccess: () => {
            // Show the toast now, so a fast result is not missed between polls.
            showPhase(`Updating Argus: ${PHASE_LABEL.downloading}`);
            qc.setQueryData(updateStatusQuery.queryKey, {
                phase: "downloading",
                error: null,
            });
            void qc.invalidateQueries({
                queryKey: updateStatusQuery.queryKey,
            });
        },
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

    useEffect(() => {
        const phase = status?.phase;
        if (!phase) return;
        if (isUpdateRunning(phase)) {
            showPhase(`Updating Argus: ${PHASE_LABEL[phase]}`);
            return;
        }
        if (liveToast === null) return;
        const id = liveToast;
        liveToast = null;
        if (phase === "done") {
            // Sticky: the user must see the reload step.
            updateToast(
                id,
                {
                    message: "Update installed. Reload extensions to finish.",
                    kind: "success",
                },
                null,
            );
        } else if (phase === "error") {
            updateToast(
                id,
                {
                    message: `Update failed: ${status?.error ?? "unknown error"}`,
                    kind: "error",
                },
                6000,
            );
        }
        void qc.invalidateQueries({ queryKey: ["notices"] });
    }, [status, qc]);
}
