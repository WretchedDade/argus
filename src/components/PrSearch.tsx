import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import { pushToast } from "../lib/toast";

// Jump to a PR's detail page by its number. Resolves against the store (any
// state, including closed) so historical PRs are reachable.
export function PrSearch() {
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const navigate = useNavigate();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const number = Number(value.trim().replace(/^#/, ""));
        if (!Number.isInteger(number) || number <= 0) return;
        setBusy(true);
        try {
            const canonical = await api.findPr(number);
            if (canonical) {
                setValue("");
                void navigate({ to: "/pr", search: { c: canonical } });
                return;
            }
            // Not tracked yet — try to add it (e.g. an older PR your team was added to
            // after the recency window, which auto-discovery skips).
            const added = await api.trackPr(number);
            if (added.ok && added.canonical) {
                setValue("");
                pushToast(`Added #${number} to your tracker`);
                void navigate({ to: "/pr", search: { c: added.canonical } });
            } else {
                const msg =
                    added.reason === "not-assigned"
                        ? `You're not a reviewer on #${number}`
                        : added.reason === "closed"
                          ? `#${number} is already closed`
                          : added.reason === "not-found"
                            ? `PR #${number} not found`
                            : `Couldn't add #${number}`;
                pushToast(msg, "error");
            }
        } catch {
            pushToast("Search failed", "error");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className="relative flex items-center">
            <Search
                size={13}
                className="pointer-events-none absolute left-2 text-white/50"
            />
            <input
                type="text"
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="PR #"
                aria-label="Search PR by number"
                disabled={busy}
                className="w-28 rounded-md border border-white/15 bg-white/10 py-1 pl-7 pr-2 text-sm text-white placeholder:text-white/45 focus:border-white/30 focus:outline-none"
            />
        </form>
    );
}
