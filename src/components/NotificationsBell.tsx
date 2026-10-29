import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bell, Download, RefreshCw } from "lucide-react";
import { api, archivableQuery, noticesQuery } from "../lib/api";
import { shortRepo } from "../lib/format";
import { pushToast } from "../lib/toast";
import { usePending } from "../lib/usePending";

// The bell lists things that need attention: Argus notices (new release,
// updated baseline skill) and review sessions whose PR has merged/closed with
// no further work. Archiving dispatches a request to chat, which cleans up the
// finished worktree sessions in bulk.
export function NotificationsBell() {
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const { pending, run } = usePending();

    const archivable = useQuery(archivableQuery).data ?? [];
    const notices = useQuery(noticesQuery).data ?? [];
    const badge = archivable.length + notices.length;

    const dismiss = async (id: string) => {
        try {
            await api.dismissNotice(id);
            void qc.invalidateQueries({ queryKey: ["notices"] });
        } catch {
            pushToast("Couldn't dismiss the notice", "error");
        }
    };
    const archive = () =>
        run(async () => {
            try {
                await api.archive();
                pushToast("Archive request sent to chat");
                void qc.invalidateQueries({ queryKey: ["archivable"] });
                setOpen(false);
            } catch {
                pushToast("Couldn't send archive request", "error");
            }
        });

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
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOpen(false)}
                    />
                    <div
                        className="border-line text-fg absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-96 overflow-hidden rounded-lg border shadow-lg"
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
                                {notices.map((n) => (
                                    <div
                                        key={n.id}
                                        className="flex items-start gap-3 px-3.5 py-2.5"
                                    >
                                        <span
                                            className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                                            style={{
                                                background:
                                                    "color-mix(in srgb, var(--peacock-teal) 18%, transparent)",
                                                color: "var(--peacock-teal)",
                                            }}
                                        >
                                            {n.kind === "app-update" ? (
                                                <Download size={12} />
                                            ) : (
                                                <RefreshCw size={12} />
                                            )}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-fg text-sm font-medium">
                                                {n.title}
                                            </div>
                                            <div className="text-muted mt-1 whitespace-pre-line break-words text-xs leading-relaxed">
                                                {n.detail}
                                            </div>
                                            <div className="mt-2.5 flex gap-2 text-xs">
                                                {n.href && (
                                                    <a
                                                        href={n.href}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="rounded-md px-2.5 py-1 font-semibold text-white"
                                                        style={{
                                                            background:
                                                                "var(--peacock-teal)",
                                                        }}
                                                    >
                                                        View release
                                                    </a>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void dismiss(n.id)
                                                    }
                                                    className="border-line text-muted hover:text-fg rounded-md border px-2.5 py-1 font-medium"
                                                >
                                                    Dismiss
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {archivable.length > 0 && (
                            <div className="border-line flex flex-col border-t first:border-t-0">
                                <div className="text-muted border-line border-b px-3.5 py-2.5 text-xs">
                                    {archivable.length} review session
                                    {archivable.length === 1 ? "" : "s"} from
                                    merged or stale PRs, ready to clean up.
                                </div>
                                <div className="divide-line max-h-[calc(70vh-8rem)] divide-y overflow-y-auto">
                                    {archivable.map((a) => (
                                        <div
                                            key={a.sessionId}
                                            className="flex items-start gap-3 px-3.5 py-2.5"
                                        >
                                            <span
                                                className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                                                style={{
                                                    background:
                                                        "color-mix(in srgb, var(--peacock-gold) 18%, transparent)",
                                                    color: "color-mix(in srgb, var(--peacock-gold) 78%, var(--color-fg))",
                                                }}
                                            >
                                                <Archive size={12} />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-fg truncate text-sm font-medium">
                                                    {shortRepo(a.repo)} #
                                                    {a.number}
                                                </div>
                                                <div className="text-muted text-[11px] capitalize">
                                                    {a.status}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="border-line border-t p-2.5">
                                    <button
                                        type="button"
                                        onClick={archive}
                                        disabled={pending}
                                        className="w-full rounded-md px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                                        style={{
                                            background: "var(--peacock-teal)",
                                        }}
                                    >
                                        {pending
                                            ? "Sending…"
                                            : `Archive ${archivable.length} session${archivable.length === 1 ? "" : "s"}`}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
