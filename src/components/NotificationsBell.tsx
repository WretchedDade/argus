import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bell } from "lucide-react";
import { api, archivableQuery } from "../lib/api";
import { shortRepo } from "../lib/format";
import { pushToast } from "../lib/toast";
import { usePending } from "../lib/usePending";

// The bell is a focused "ready to archive" queue: review sessions whose PR has
// merged/closed with no further work. Archiving dispatches a request to chat,
// which cleans up the finished worktree sessions in bulk.
export function NotificationsBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { pending, run } = usePending();

  const archivable = useQuery(archivableQuery).data ?? [];
  const badge = archivable.length;

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
        aria-label="Ready to archive"
        className="relative text-white/80 transition-colors hover:text-white"
      >
        <Bell size={18} />
        {badge > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4"
            style={{ background: "var(--peacock-gold)", color: "#3a2c00" }}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="border-line text-fg absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-96 overflow-hidden rounded-lg border shadow-lg"
            style={{ background: "var(--card-bg)" }}
          >
            <div className="border-line flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-semibold">Ready to archive</span>
              {badge === 0 && <span className="text-muted text-xs">Nothing to archive</span>}
            </div>

            {archivable.length === 0 ? (
              <p className="text-muted px-3 py-6 text-center text-sm">
                No finished review sessions to clean up.
              </p>
            ) : (
              <div className="flex flex-col">
                <div className="text-muted border-line border-b px-3.5 py-2.5 text-xs">
                  {archivable.length} review session{archivable.length === 1 ? "" : "s"} from merged or stale PRs, ready to clean up.
                </div>
                <div className="divide-line max-h-[calc(70vh-8rem)] divide-y overflow-y-auto">
                  {archivable.map((a) => (
                    <div key={a.sessionId} className="flex items-start gap-3 px-3.5 py-2.5">
                      <span
                        className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                        style={{ background: "color-mix(in srgb, var(--peacock-gold) 18%, transparent)", color: "color-mix(in srgb, var(--peacock-gold) 78%, var(--color-fg))" }}
                      >
                        <Archive size={12} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-fg truncate text-sm font-medium">
                          {shortRepo(a.repo)} #{a.number}
                        </div>
                        <div className="text-muted text-[11px] capitalize">{a.status}</div>
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
                    style={{ background: "var(--peacock-teal)" }}
                  >
                    {pending ? "Sending…" : `Archive ${archivable.length} session${archivable.length === 1 ? "" : "s"}`}
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
