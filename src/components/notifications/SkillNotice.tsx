import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api, type Notice } from "../../lib/api";
import { pushToast } from "../../lib/toast";
import { NoticeRow, PrimaryButton, SecondaryButton } from "./NoticeRow";

// A newer baseline skill exists. Copilot can merge it, or the user can swap in
// the bundled copy (Argus backs up the old one first).
export function SkillNotice({
    notice,
    onDone,
}: {
    notice: Notice;
    onDone: () => void;
}) {
    const qc = useQueryClient();
    const refresh = () => qc.invalidateQueries({ queryKey: ["notices"] });

    const mergeWithCopilot = useMutation({
        mutationFn: () => api.actOnNotice(notice.id),
        onSuccess: () => {
            pushToast("Merge request sent to chat");
            void refresh();
            onDone();
        },
        onError: () =>
            pushToast("Couldn't send the merge request to chat", "error"),
    });

    const useNewVersion = useMutation({
        mutationFn: () => api.useBundledSkill(),
        onSuccess: ({ backupPath }) => {
            pushToast(`Skill replaced. Your old copy is in ${backupPath}`);
            void refresh();
            onDone();
        },
        onError: (err) =>
            pushToast(`Couldn't replace the skill: ${err.message}`, "error"),
    });

    const busy = mergeWithCopilot.isPending || useNewVersion.isPending;

    return (
        <NoticeRow notice={notice} icon={<RefreshCw size={12} />}>
            {notice.actionLabel && (
                <PrimaryButton
                    onClick={() => mergeWithCopilot.mutate()}
                    disabled={busy}
                >
                    {mergeWithCopilot.isPending
                        ? "Sending…"
                        : notice.actionLabel}
                </PrimaryButton>
            )}
            {notice.secondaryActionLabel && (
                <SecondaryButton
                    onClick={() => useNewVersion.mutate()}
                    disabled={busy}
                >
                    {useNewVersion.isPending
                        ? "Replacing…"
                        : notice.secondaryActionLabel}
                </SecondaryButton>
            )}
        </NoticeRow>
    );
}
