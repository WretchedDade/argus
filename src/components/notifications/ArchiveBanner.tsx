import { useState } from "react";
import { Alert, Group } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { archivableQuery } from "../../lib/api";
import { useArchive } from "../../lib/useArchive";
import { PrimaryButton, SecondaryButton } from "./NoticeRow";

const STORAGE_KEY = "argus.archiveBannerDismissed";

function loadDismissed(): string[] {
    try {
        const raw: unknown = JSON.parse(
            localStorage.getItem(STORAGE_KEY) ?? "[]",
        );
        return Array.isArray(raw) ? (raw as string[]) : [];
    } catch {
        return [];
    }
}

// Tells the user, on every page, that finished review sessions can be archived.
// "Not now" hides it until a session that was not there before shows up.
export function ArchiveBanner() {
    const sessions = useQuery(archivableQuery).data ?? [];
    const [dismissed, setDismissed] = useState(loadDismissed);

    const dismiss = () => {
        const ids = sessions.map((s) => s.sessionId);
        setDismissed(ids);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
        } catch {
            // Storage is blocked or full: the banner still hides for this page load.
        }
    };
    const archive = useArchive(dismiss);

    if (sessions.every((s) => dismissed.includes(s.sessionId))) return null;

    const n = sessions.length;
    const plural = n === 1 ? "" : "s";
    return (
        <Alert
            role="status"
            title={`${n} review session${plural} ready to archive.`}
            icon={<Archive size={16} />}
            mb="md"
        >
            Their PRs merged or went stale. Argus can clean them up for you.
            <Group gap="xs" mt="sm">
                <PrimaryButton
                    onClick={() => archive.mutate()}
                    disabled={archive.isPending}
                    loading={archive.isPending}
                >
                    {archive.isPending
                        ? "Sending…"
                        : `Archive ${n} session${plural}`}
                </PrimaryButton>
                <SecondaryButton onClick={dismiss}>Not now</SecondaryButton>
            </Group>
        </Alert>
    );
}
