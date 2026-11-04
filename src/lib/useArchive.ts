import {
    useIsMutating,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api";
import { pushToast } from "./toast";

const ARCHIVE_KEY = ["archive"];

// Sends the archive request to chat. Shared by the bell and the banner.
export function useArchive(onDone?: () => void) {
    const qc = useQueryClient();
    // The bell and the banner share one pending state, so only one request runs.
    const running = useIsMutating({ mutationKey: ARCHIVE_KEY }) > 0;
    const mutation = useMutation({
        mutationKey: ARCHIVE_KEY,
        mutationFn: () => api.archive(),
        onSuccess: () => {
            pushToast("Archive request sent to chat");
            void qc.invalidateQueries({ queryKey: ["archivable"] });
            onDone?.();
        },
        onError: () => pushToast("Couldn't send archive request", "error"),
    });
    return { mutate: mutation.mutate, isPending: running };
}
