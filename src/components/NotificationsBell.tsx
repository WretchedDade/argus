import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import {
    ActionIcon,
    Group,
    Indicator,
    Popover,
    ScrollArea,
    Text,
} from "@mantine/core";
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
            <Indicator
                disabled={badge === 0}
                label={badge > 99 ? "99+" : badge}
                size={16}
            >
                <Popover.Target>
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label="Notifications"
                        onClick={() => setOpen((value) => !value)}
                    >
                        <Bell size={18} />
                    </ActionIcon>
                </Popover.Target>
            </Indicator>
            <Popover.Dropdown
                p={0}
                maw="calc(100vw - 2rem)"
                mah="70vh"
                style={{ overflow: "hidden" }}
                aria-label="Notifications"
            >
                <Group
                    justify="space-between"
                    gap="xs"
                    px="sm"
                    py="xs"
                    style={{
                        borderBottom:
                            "1px solid var(--mantine-color-default-border)",
                    }}
                >
                    <Text size="sm" fw={600}>
                        Notifications
                    </Text>
                    {badge === 0 && (
                        <Text c="dimmed" size="xs">
                            All caught up
                        </Text>
                    )}
                </Group>

                <ScrollArea.Autosize
                    mah="calc(70vh - 2.5rem)"
                    type="auto"
                    offsetScrollbars="y"
                >
                    {badge === 0 && (
                        <p className="text-muted px-3 py-6 text-center text-sm">
                            Nothing needs your attention.
                        </p>
                    )}

                    {notices.length > 0 && (
                        <div className="divide-line divide-y">
                            {notices.map((n) => {
                                switch (n.kind) {
                                    case "app-update":
                                    case "plugin-update":
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
                </ScrollArea.Autosize>
            </Popover.Dropdown>
        </Popover>
    );
}
