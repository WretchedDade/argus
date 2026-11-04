import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { archivableQuery, noticesQuery } from "../lib/api";
import { ArchiveSection } from "./notifications/ArchiveSection";
import { SkillNotice } from "./notifications/SkillNotice";
import { StorageNotice } from "./notifications/StorageNotice";
import { UpdateNotice } from "./notifications/UpdateNotice";

// The bell lists things that need attention: Argus notices (new release,
// updated baseline skill) and review sessions whose PR has merged/closed with
// no further work. Each kind of item owns its own actions.
export function NotificationsBell() {
    const [open, setOpen] = useState(false);

    const archivable = useQuery(archivableQuery).data ?? [];
    const notices = useQuery(noticesQuery).data ?? [];
    const badge = archivable.length + notices.length;
    const close = () => setOpen(false);

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label="Notifications"
                className="relative text-white/80 transition-colors hover:text-white"
            >
                <Bell size={18} />
                {badge > 0 && (
                    <span
                        className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4"
                        style={{
                            background: "var(--peacock-gold)",
                            color: "#3a2c00",
                        }}
                    >
                        {badge > 99 ? "99+" : badge}
                    </span>
                )}
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={close} />
                    <div
                        className="border-line text-fg absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-96 overflow-y-auto rounded-lg border shadow-lg"
                        style={{ background: "var(--card-bg)" }}
                    >
                        <div className="border-line flex items-center justify-between border-b px-3 py-2">
                            <span className="text-sm font-semibold">
                                Notifications
                            </span>
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
                            <ArchiveSection
                                sessions={archivable}
                                onDone={close}
                            />
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
