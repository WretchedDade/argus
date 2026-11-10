import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { ActionIcon, Indicator, Popover } from "@mantine/core";
import { archivableQuery, noticesQuery } from "../lib/api";
import { ArchiveSection } from "./notifications/ArchiveSection";
import { SkillNotice } from "./notifications/SkillNotice";
import { StorageNotice } from "./notifications/StorageNotice";
import { UpdateNotice } from "./notifications/UpdateNotice";
import { useUpdate } from "../lib/useUpdate";

// The bell lists things that need attention: Argus notices (new release,
// updated baseline skill) and review sessions whose PR has merged/closed with
// no further work. Each kind of item owns its own actions.
export function NotificationsBell() {
    const [open, setOpen] = useState(false);

    const archivable = useQuery(archivableQuery).data ?? [];
    const updating = useUpdate().running;
    const allNotices = useQuery(noticesQuery).data ?? [];
    // The toast shows the progress, so the update notice hides while it runs.
    const notices = allNotices.filter(
        (n) => !(updating && n.kind === "app-update"),
    );
    const badge = archivable.length + notices.length;
    const close = () => setOpen(false);

    return (
        <Popover
            opened={open}
            onChange={setOpen}
            position="bottom-end"
            shadow="md"
            width={384}
            withinPortal
            trapFocus
        >
            <Popover.Target>
                <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Notifications"
                    onClick={() => setOpen((value) => !value)}
                >
                    <Indicator
                        disabled={badge === 0}
                        label={badge > 99 ? "99+" : badge}
                        size={16}
                    >
                        <Bell size={18} />
                    </Indicator>
                </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown
                p={0}
                maw="calc(100vw - 2rem)"
                mah="70vh"
                style={{ overflowY: "auto" }}
                aria-label="Notifications"
            >
                <div className="border-line flex items-center justify-between border-b px-3 py-2">
                    <span className="text-sm font-semibold">Notifications</span>
                    {badge === 0 && (
                        <span className="text-muted text-xs">
                            All caught up
                        </span>
                    )}
                </div>

                {badge === 0 && (
                    <p className="text-muted px-3 py-6 text-center text-sm">
                        Nothing needs your attention.
                    </p>
                )}

                {notices.length > 0 && (
                    <div className="divide-line divide-y overflow-y-auto">
                        {notices.map((n) => {
                            switch (n.kind) {
                                case "app-update":
                                    return (
                                        <UpdateNotice
                                            key={n.id}
                                            notice={n}
                                            onDone={close}
                                        />
                                    );
                                case "skill-update":
                                    return (
                                        <SkillNotice
                                            key={n.id}
                                            notice={n}
                                            onDone={close}
                                        />
                                    );
                                case "storage":
                                    return (
                                        <StorageNotice
                                            key={n.id}
                                            notice={n}
                                            onDone={close}
                                        />
                                    );
                            }
                        })}
                    </div>
                )}

                {archivable.length > 0 && (
                    <ArchiveSection sessions={archivable} onDone={close} />
                )}
            </Popover.Dropdown>
        </Popover>
    );
}
