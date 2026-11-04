import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { pushToast } from "./toast";

// Sends the archive request to chat. Shared by the bell and the banner.
export function useArchive(onDone?: () => void) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api.archive(),
        onSuccess: () => {
            pushToast("Archive request sent to chat");
            void qc.invalidateQueries({ queryKey: ["archivable"] });
            onDone?.();
        },
        onError: () => pushToast("Couldn't send archive request", "error"),
    });
}
