import { Download } from "lucide-react";
import { Button } from "@mantine/core";
import type { Notice } from "../../lib/api";
import { useUpdate } from "../../lib/useUpdate";
import { NoticeRow, PrimaryButton } from "./NoticeRow";

// The bell closes after starting an install. Settings stays open.
export function UpdateNotice({
    notice,
    onDone,
}: {
    notice: Notice;
    onDone?: () => void;
}) {
    const update = useUpdate();

    return (
        <NoticeRow notice={notice} icon={<Download size={12} />}>
            {notice.actionLabel && (
                <PrimaryButton
                    onClick={() => {
                        update.start();
                        onDone?.();
                    }}
                    disabled={update.running}
                    loading={update.running}
                >
                    {update.running ? "Starting…" : notice.actionLabel}
                </PrimaryButton>
            )}
            {notice.href && (
                <Button
                    size="xs"
                    flex="0 0 auto"
                    component="a"
                    variant="default"
                    href={notice.href}
                    target="_blank"
                    rel="noreferrer"
                >
                    View release
                </Button>
            )}
        </NoticeRow>
    );
}
