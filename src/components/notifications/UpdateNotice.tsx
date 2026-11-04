import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api, type Notice } from "../../lib/api";
import { pushToast } from "../../lib/toast";
import { NoticeRow, PrimaryButton } from "./NoticeRow";

// A new Argus release. "Install" applies the update in place.
export function UpdateNotice({
    notice,
    onDone,
}: {
    notice: Notice;
    onDone: () => void;
}) {
    const qc = useQueryClient();
    const applyUpdate = useMutation({
        mutationFn: () => api.applyUpdate(),
        onSuccess: () => {
            pushToast("Update installed. Reload extensions to finish.");
            void qc.invalidateQueries({ queryKey: ["notices"] });
            onDone();
        },
        onError: (err) => pushToast(`Update failed: ${err.message}`, "error"),
    });

    return (
        <NoticeRow notice={notice} icon={<Download size={12} />}>
            {notice.actionLabel && (
                <PrimaryButton
                    onClick={() => applyUpdate.mutate()}
                    disabled={applyUpdate.isPending}
                >
                    {applyUpdate.isPending ? "Installing…" : notice.actionLabel}
                </PrimaryButton>
            )}
            {notice.href && (
                <a
                    href={notice.href}
                    target="_blank"
                    rel="noreferrer"
                    className="border-line text-muted hover:text-fg rounded-md border px-2.5 py-1 font-medium"
                >
                    View release
                </a>
            )}
        </NoticeRow>
    );
}
