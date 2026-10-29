import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, healthQuery, type AuthRegistration } from "../lib/api";
import { pushToast } from "../lib/toast";

const asJson = (r: AuthRegistration) =>
    JSON.stringify({ clientId: r.clientId, tenantId: r.tenantId }, null, 2);

// Settings: copy the registration IDs so a teammate can paste them into their sign-in screen.
export function RegistrationShare() {
    const reg = useQuery({
        queryKey: ["auth-registration"],
        queryFn: api.authRegistration,
    }).data;
    if (!reg?.clientId || !reg.tenantId) return null;
    return (
        <div>
            <div className="text-fg text-sm font-medium">
                Share Windows account setup
            </div>
            <div className="text-muted mt-1 text-xs">
                These IDs are not secret. Send them to a teammate. They paste
                them into the Azure DevOps sign-in screen.
            </div>
            <pre className="border-line mt-2 overflow-x-auto rounded-md border p-2 text-xs">
                {asJson(reg)}
            </pre>
            <button
                type="button"
                className="border-line mt-2 rounded-md border px-3 py-1 text-xs"
                onClick={() =>
                    void navigator.clipboard
                        .writeText(asJson(reg))
                        .then(() => pushToast("Setup copied"))
                }
            >
                Copy
            </button>
        </div>
    );
}

// Sign-in screen: accept pasted JSON ({clientId, tenantId}) and save it.
export function RegistrationImport() {
    const qc = useQueryClient();
    const [text, setText] = useState("");
    const save = useMutation({
        mutationFn: async () => {
            let parsed: Partial<AuthRegistration>;
            try {
                parsed = JSON.parse(text);
            } catch {
                throw new Error(
                    'Paste the setup JSON, like {"clientId": "...", "tenantId": "..."}.',
                );
            }
            await api.saveAuthRegistration({
                clientId: parsed.clientId ?? "",
                tenantId: parsed.tenantId ?? "",
            });
            await api.refresh();
        },
        onSettled: () => qc.invalidateQueries(),
    });
    return (
        <div className="flex flex-col gap-2">
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={'{\n  "clientId": "...",\n  "tenantId": "..."\n}'}
                className="border-line w-full rounded-md border bg-transparent p-2 font-mono text-xs"
            />
            {save.error && (
                <p className="text-xs text-red-500" role="alert">
                    {(save.error as Error).message}
                </p>
            )}
            <button
                type="button"
                disabled={!text.trim() || save.isPending}
                onClick={() => save.mutate()}
                className="border-line self-start rounded-md border px-3 py-1 text-xs disabled:opacity-50"
            >
                Save setup
            </button>
        </div>
    );
}

// Settings: who is signed in (Windows account mode), with switch and sign-out.
export function AccountPanel() {
    const qc = useQueryClient();
    const auth = useQuery(healthQuery).data?.auth;
    const act = useMutation({
        mutationFn: (kind: "switch" | "out") =>
            kind === "out" ? api.signOut() : api.switchAccount(),
        onSettled: () => qc.invalidateQueries(),
    });
    if (!auth?.configured) return null;
    const btn =
        "border-line rounded-md border px-3 py-1 text-xs disabled:opacity-50";
    return (
        <div>
            <div className="text-fg text-sm font-medium">Account</div>
            <div className="text-muted mt-1 text-xs">
                {auth.account
                    ? `Signed in as ${auth.account.username}`
                    : "Not signed in"}
            </div>
            {auth.account && (
                <div className="mt-2 flex gap-2">
                    <button
                        type="button"
                        className={btn}
                        disabled={act.isPending}
                        onClick={() => act.mutate("switch")}
                    >
                        Switch account
                    </button>
                    <button
                        type="button"
                        className={btn}
                        disabled={act.isPending}
                        onClick={() => act.mutate("out")}
                    >
                        Sign out
                    </button>
                </div>
            )}
            {act.error && (
                <p className="mt-1 text-xs text-red-500" role="alert">
                    {(act.error as Error).message}
                </p>
            )}
        </div>
    );
}
