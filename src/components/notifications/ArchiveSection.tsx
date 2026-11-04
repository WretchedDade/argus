import { Archive } from "lucide-react";
import type { ArchivableSession } from "../../lib/api";
import { shortRepo } from "../../lib/format";
import { useArchive } from "../../lib/useArchive";
import { IconBadge } from "./IconBadge";
import { PrimaryButton } from "./NoticeRow";

// Review sessions whose PR merged or went stale. One request to chat cleans
// up all of them.
export function ArchiveSection({
    sessions,
    onDone,
}: {
    sessions: ArchivableSession[];
    onDone: () => void;
}) {
    const archive = useArchive(onDone);
    const plural = sessions.length === 1 ? "" : "s";

    return (
        <div className="border-line flex flex-col border-t first:border-t-0">
            <div className="text-muted border-line border-b px-3.5 py-2.5 text-xs">
                {sessions.length} review session{plural} from merged or stale
                PRs, ready to clean up.
            </div>
            <div className="divide-line max-h-[calc(70vh-8rem)] divide-y overflow-y-auto">
                {sessions.map((a) => (
                    <div
                        key={a.sessionId}
                        className="flex items-start gap-3 px-3.5 py-2.5"
                    >
                        <IconBadge tone="gold">
                            <Archive size={12} />
                        </IconBadge>
                        <div className="min-w-0 flex-1">
                            <div className="text-fg truncate text-sm font-medium">
                                {shortRepo(a.repo)} #{a.number}
                            </div>
                            <div className="text-muted text-[11px] capitalize">
                                {a.status}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="border-line border-t p-2.5">
                <PrimaryButton
                    className="w-full py-1.5 text-xs"
                    onClick={() => archive.mutate()}
                    disabled={archive.isPending}
                >
                    {archive.isPending
                        ? "Sending…"
                        : `Archive ${sessions.length} session${plural}`}
                </PrimaryButton>
            </div>
        </div>
    );
}
