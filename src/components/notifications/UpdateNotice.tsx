import { Download } from "lucide-react";
import type { Notice } from "../../lib/api";
import { useUpdate } from "../../lib/useUpdate";
import { NoticeRow, PrimaryButton } from "./NoticeRow";

// A new Argus release. "Update now" starts the install on the server and closes
// the bell. A toast shows the progress from there.
export function UpdateNotice({
    notice,
    onDone,
}: {
    notice: Notice;
    onDone: () => void;
}) {
    const update = useUpdate();

    return (
        <NoticeRow notice={notice} icon={<Download size={12} />}>
            {notice.actionLabel && (
                <PrimaryButton
                    onClick={() => {
                        update.start();
                        onDone();
                    }}
                    disabled={update.running}
                >
                    {update.running ? "Starting…" : notice.actionLabel}
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
