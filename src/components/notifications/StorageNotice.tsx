import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { api, type Notice } from "../../lib/api";
import { pushToast } from "../../lib/toast";
import { NoticeRow, PrimaryButton } from "./NoticeRow";

// The database is still on OneDrive. Copilot asks where it should live.
export function StorageNotice({
    notice,
    onDone,
}: {
    notice: Notice;
    onDone: () => void;
}) {
    const qc = useQueryClient();
    const chooseWithCopilot = useMutation({
        mutationFn: () => api.actOnNotice(notice.id),
        onSuccess: () => {
            pushToast("Storage question sent to chat");
            void qc.invalidateQueries({ queryKey: ["notices"] });
            onDone();
        },
        onError: () =>
            pushToast("Couldn't send the storage question to chat", "error"),
    });

    return (
        <NoticeRow notice={notice} icon={<HardDrive size={12} />}>
            {notice.actionLabel && (
                <PrimaryButton
                    onClick={() => chooseWithCopilot.mutate()}
                    disabled={chooseWithCopilot.isPending}
                >
                    {chooseWithCopilot.isPending
                        ? "Sending…"
                        : notice.actionLabel}
                </PrimaryButton>
            )}
        </NoticeRow>
    );
}
