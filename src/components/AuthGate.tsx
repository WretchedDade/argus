import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, configApi, type ArgusConfig } from "../lib/api";
import { BrandMark } from "./BrandMark";
import { RegistrationImport } from "./AuthRegistration";
import { SegToggle } from "./SegToggle";

type Provider = ArgusConfig["adoAuth"];

// Shown when Argus cannot reach Azure DevOps with the current sign-in method.
// Same shell as the first-run SetupGate: pick a method, follow its steps, check again.
export function AuthGate({ onDismiss }: { onDismiss: () => void }) {
    const qc = useQueryClient();
    const status = useQuery({
        queryKey: ["auth"],
        queryFn: api.authStatus,
    });
    const auth = status.data;
    const provider: Provider = auth?.provider ?? "az";

    const recheck = useMutation({
        mutationFn: async (action?: () => Promise<unknown>) => {
            await action?.();
            await api.refresh();
        },
        onSettled: () => qc.invalidateQueries(),
    });
    const setProvider = useMutation({
        mutationFn: (adoAuth: Provider) => configApi.save({ adoAuth }),
        onSuccess: () => qc.invalidateQueries(),
    });

    const busy =
        recheck.isPending || setProvider.isPending || status.isFetching;
    const error =
        (recheck.error as Error | null)?.message ??
        (setProvider.error as Error | null)?.message ??
        (auth?.configured ? auth.error : null);

    return (
        <div className="app-bg text-fg flex min-h-screen items-center justify-center p-6">
            <div
                className="border-line w-full max-w-lg rounded-2xl border p-6 shadow-lg"
                style={{ background: "var(--card-bg)" }}
            >
                <div className="mb-1 flex items-center gap-2.5">
                    <span className="app-header flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                        <BrandMark size={26} />
                    </span>
                    <span className="text-lg font-semibold tracking-tight">
                        Sign in to Azure DevOps
                    </span>
                </div>
                <p className="text-muted mb-5 text-sm">
                    Argus needs access to Azure DevOps to watch your pull
                    requests. Choose how it should sign in. You can change this
                    later in Settings.
                </p>

                <SegToggle
                    value={provider}
                    onChange={(v) => setProvider.mutate(v)}
                    options={[
                        { v: "az", label: "Azure CLI" },
                        { v: "broker", label: "Windows account" },
                    ]}
                />

                <div className="mt-4 flex flex-col gap-3 text-sm">
                    {provider === "az" && (
                        <p>
                            Run <code>az login</code> in a terminal, then check
                            again.
                        </p>
                    )}
                    {provider === "broker" && auth && !auth.configured && (
                        <>
                            <p>
                                Windows account sign-in needs a one-time setup:
                                an Entra app registration for Argus. Ask a
                                teammate to copy their setup from Settings, then
                                paste it here.
                            </p>
                            <RegistrationImport />
                            <p className="text-muted text-xs">
                                Prefer files? Use the environment variables{" "}
                                <code>DEVSTART_ADO_CLIENT_ID</code> and{" "}
                                <code>DEVSTART_ADO_TENANT_ID</code>, or{" "}
                                <code>
                                    %LOCALAPPDATA%\devstart\ado-auth-config.json
                                </code>
                                .
                            </p>
                            <p className="text-muted text-xs">
                                Don't have one? Choose Azure CLI above and run{" "}
                                <code>az login</code> instead.
                            </p>
                        </>
                    )}
                    {provider === "broker" && auth?.configured && (
                        <p>
                            Sign in with your Windows account. A Windows prompt
                            appears only if Azure DevOps needs more from you.
                        </p>
                    )}
                    {error && (
                        <p className="text-xs text-red-500" role="alert">
                            {error}
                        </p>
                    )}
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                    {provider === "broker" && auth?.configured && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => recheck.mutate(api.signIn)}
                            className="app-header inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {busy && (
                                <Loader2 size={15} className="animate-spin" />
                            )}
                            Sign in
                        </button>
                    )}
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => recheck.mutate(undefined)}
                        className={
                            provider === "broker" && auth?.configured
                                ? "border-line hover:bg-black/5 rounded-lg border px-4 py-2.5 text-sm"
                                : "app-header inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        }
                    >
                        Check again
                    </button>
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="border-line hover:bg-black/5 rounded-lg border px-4 py-2.5 text-sm text-muted"
                    >
                        Skip
                    </button>
                </div>
            </div>
        </div>
    );
}
