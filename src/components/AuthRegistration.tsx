import { Button, TextInput } from "@mantine/core";
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, healthQuery, type AuthRegistration } from "../lib/api";
import { pushToast } from "../lib/toast";
import {
    validateRegistration,
    type RegistrationErrors,
    type RegistrationValues,
} from "../lib/auth-registration";

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
                These IDs are not secret. Send them to a teammate. They enter
                clientId in Application (client) ID and tenantId in Directory
                (tenant) ID on the Azure DevOps sign-in screen.
            </div>
            <pre className="border-line mt-2 overflow-x-auto rounded-md border p-2 text-xs">
                {asJson(reg)}
            </pre>
            <Button
                variant="default"
                type="button"
                className="mt-2"
                onClick={() =>
                    void navigator.clipboard
                        .writeText(asJson(reg))
                        .then(() => pushToast("Setup copied"))
                }
            >
                Copy
            </Button>
        </div>
    );
}

// Shared by sign-in and Settings; a fieldset avoids nesting Settings' form.
export function RegistrationImport() {
    const qc = useQueryClient();
    const registration = useQuery({
        queryKey: ["auth-registration"],
        queryFn: api.authRegistration,
    });
    const id = useId();
    const clientInput = useRef<HTMLInputElement>(null);
    const tenantInput = useRef<HTMLInputElement>(null);
    // Keep edits separate from fetched values so refetches never discard input.
    const [draft, setDraft] = useState<RegistrationValues | null>(null);
    const values = draft ?? registration.data ?? { clientId: "", tenantId: "" };
    const [errors, setErrors] = useState<RegistrationErrors>({});
    const [refreshError, setRefreshError] = useState(false);
    const save = useMutation({
        mutationFn: (reg: RegistrationValues) => api.saveAuthRegistration(reg),
        onSuccess: async (reg) => {
            qc.setQueryData(["auth-registration"], reg);
            setDraft(null);
            pushToast("Setup saved");
            try {
                const { summary, skipped } = await api.refresh();
                if (summary === null && !skipped) setRefreshError(true);
            } catch {
                setRefreshError(true);
            }
        },
        onSettled: () => qc.invalidateQueries(),
    });
    const submit = () => {
        if (save.isPending || !registration.data) return;
        const nextErrors = validateRegistration(values);
        setErrors(nextErrors);
        setRefreshError(false);
        save.reset();
        if (nextErrors.clientId || nextErrors.tenantId) {
            (nextErrors.clientId ? clientInput : tenantInput).current?.focus();
            return;
        }
        save.mutate({
            clientId: values.clientId.trim(),
            tenantId: values.tenantId.trim(),
        });
    };
    return (
        <fieldset
            className="flex min-w-0 flex-col gap-2"
            aria-busy={save.isPending || registration.isPending}
            aria-describedby={`${id}-help`}
            onKeyDown={(e) => {
                if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    e.target instanceof HTMLInputElement
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    submit();
                }
            }}
        >
            <legend className="text-fg mb-2 text-sm font-medium">
                Windows account setup
            </legend>
            <p id={`${id}-help`} className="text-muted text-xs">
                Enter the two non-secret IDs from your Entra app registration.
                Save setup saves only these IDs, not your sign-in method.
            </p>
            {registration.isPending && (
                <p role="status" className="text-muted text-xs">
                    Loading setup…
                </p>
            )}
            {registration.isError && (
                <p role="alert" className="text-xs text-red-500">
                    Could not load setup.{" "}
                    <Button
                        variant="default"
                        type="button"
                        onClick={() => void registration.refetch()}
                    >
                        Try again
                    </Button>
                </p>
            )}
            {registration.data?.fromEnv && (
                <p role="note" className="text-muted text-xs">
                    One or both IDs come from DEVSTART_ADO_CLIENT_ID or
                    DEVSTART_ADO_TENANT_ID. Environment values override the
                    saved file. Saving here does not change those environment
                    values.
                </p>
            )}
            {(
                [
                    ["clientId", "Application (client) ID", clientInput],
                    ["tenantId", "Directory (tenant) ID", tenantInput],
                ] as const
            ).map(([key, label, ref]) => (
                <div key={key}>
                    <label htmlFor={`${id}-${key}`} className="text-sm">
                        {label} (required)
                    </label>
                    <TextInput
                        ref={ref}
                        id={`${id}-${key}`}
                        type="text"
                        aria-required="true"
                        disabled={!registration.data}
                        readOnly={save.isPending}
                        autoComplete="off"
                        spellCheck={false}
                        value={values[key]}
                        aria-invalid={!!errors[key]}
                        aria-describedby={
                            errors[key] ? `${id}-${key}-error` : undefined
                        }
                        onChange={(e) => {
                            const value = e.target.value;
                            setDraft((previous) => ({
                                ...(previous ?? values),
                                [key]: value,
                            }));
                            setErrors((previous) => ({
                                ...previous,
                                [key]: undefined,
                            }));
                            setRefreshError(false);
                            save.reset();
                        }}
                        className="mt-1 w-full"
                    />
                    {errors[key] && (
                        <p
                            id={`${id}-${key}-error`}
                            role="alert"
                            className="mt-1 text-xs text-red-500"
                        >
                            {errors[key]}
                        </p>
                    )}
                </div>
            ))}
            {save.error && (
                <p className="text-xs text-red-500" role="alert">
                    {save.error.message}
                </p>
            )}
            <Button
                variant="default"
                type="button"
                disabled={!registration.data}
                aria-disabled={save.isPending}
                onClick={submit}
                className="self-start"
            >
                {save.isPending ? "Saving…" : "Save setup"}
            </Button>
            {save.isSuccess && (
                <p role="status" className="text-muted text-xs">
                    Setup saved. Environment overrides, if present, still apply.
                </p>
            )}
            {refreshError && (
                <p role="alert" className="text-xs text-red-500">
                    Setup was saved, but Azure DevOps could not be refreshed.
                    Check again from the sign-in screen or refresh Argus.
                </p>
            )}
        </fieldset>
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
                    <Button
                        variant="default"
                        type="button"

                        disabled={act.isPending}
                        onClick={() => act.mutate("switch")}
                    >
                        Switch account
                    </Button>
                    <Button
                        variant="default"
                        type="button"

                        disabled={act.isPending}
                        onClick={() => act.mutate("out")}
                    >
                        Sign out
                    </Button>
                </div>
            )}
            {act.error && (
                <p className="mt-1 text-xs text-red-500" role="alert">
                    {act.error.message}
                </p>
            )}
        </div>
    );
}
