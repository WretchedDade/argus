import {
    Alert,
    Button,
    Code,
    Fieldset,
    Group,
    Stack,
    Text,
    TextInput,
} from "@mantine/core";
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
        <Stack gap="sm">
            <Text size="sm" fw={500}>
                Share Windows account setup
            </Text>
            <Text size="sm" c="dimmed">
                These IDs are not secret. Send them to a teammate. They enter
                clientId in Application (client) ID and tenantId in Directory
                (tenant) ID on the Azure DevOps sign-in screen.
            </Text>
            <Code block>{asJson(reg)}</Code>
            <Group>
                <Button
                    variant="default"
                    type="button"
                    onClick={() =>
                        void navigator.clipboard
                            .writeText(asJson(reg))
                            .then(() => pushToast("Setup copied"))
                    }
                >
                    Copy
                </Button>
            </Group>
        </Stack>
    );
}

// Shared by sign-in and Settings; a fieldset avoids nesting Settings' form.
export function RegistrationImport() {
    const qc = useQueryClient();
    const registration = useQuery({
        queryKey: ["auth-registration"],
        queryFn: api.authRegistration,
    });
    const health = useQuery(healthQuery);
    const id = useId();
    const clientInput = useRef<HTMLInputElement>(null);
    const tenantInput = useRef<HTMLInputElement>(null);
    // Keep edits separate from fetched values so refetches never discard input.
    const [draft, setDraft] = useState<RegistrationValues | null>(null);
    const values = draft ?? registration.data ?? { clientId: "", tenantId: "" };
    const [errors, setErrors] = useState<RegistrationErrors>({});
    const [refreshError, setRefreshError] = useState(false);
    const refresh = useMutation({
        mutationFn: api.refresh,
        onSuccess: ({ summary, skipped }) => {
            if (summary === null && !skipped) setRefreshError(true);
        },
        onError: () => setRefreshError(true),
        onSettled: () => {
            void qc.invalidateQueries();
        },
    });
    const save = useMutation({
        mutationFn: (reg: RegistrationValues) => api.saveAuthRegistration(reg),
        onSuccess: (reg) => {
            qc.setQueryData(["auth-registration"], reg);
            setDraft(null);
            pushToast("Setup saved");
            refresh.mutate();
        },
        onSettled: () => {
            void qc.invalidateQueries();
        },
    });
    const polling = !!health.data?.poller.running || refresh.isPending;
    const submit = () => {
        if (save.isPending || polling || !registration.data) return;
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
        <Fieldset
            legend="Windows account setup"
            variant="unstyled"
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
            <Stack gap="sm">
                <Text id={`${id}-help`} size="sm" c="dimmed">
                    Enter the two non-secret IDs from your Entra app
                    registration. Save setup saves only these IDs, not your
                    sign-in method.
                </Text>
                {registration.isPending && (
                    <Text role="status" size="sm" c="dimmed">
                        Loading setup…
                    </Text>
                )}
                {registration.isError && (
                    <Alert color="red">
                        Could not load setup.{" "}
                        <Button
                            variant="default"
                            type="button"
                            onClick={() => void registration.refetch()}
                        >
                            Try again
                        </Button>
                    </Alert>
                )}
                {registration.data?.fromEnv && (
                    <Text role="note" size="sm" c="dimmed">
                        One or both IDs come from DEVSTART_ADO_CLIENT_ID or
                        DEVSTART_ADO_TENANT_ID. Environment values override the
                        saved file. Saving here does not change those
                        environment values.
                    </Text>
                )}
                {(
                    [
                        ["clientId", "Application (client) ID", clientInput],
                        ["tenantId", "Directory (tenant) ID", tenantInput],
                    ] as const
                ).map(([key, label, ref]) => (
                    <TextInput
                        key={key}
                        label={label}
                        withAsterisk
                        ref={ref}
                        id={`${id}-${key}`}
                        type="text"
                        aria-required="true"
                        disabled={!registration.data}
                        readOnly={save.isPending}
                        autoComplete="off"
                        spellCheck={false}
                        value={values[key]}
                        error={
                            errors[key] ? (
                                <span role="alert">{errors[key]}</span>
                            ) : undefined
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
                    />
                ))}
                {save.error && <Alert color="red">{save.error.message}</Alert>}
                <Group>
                    <Button
                        variant="default"
                        type="button"
                        disabled={!registration.data || polling}
                        title={
                            polling
                                ? "Wait for the current poll to finish"
                                : undefined
                        }
                        loading={save.isPending}
                        onClick={submit}
                    >
                        {save.isPending ? "Saving…" : "Save setup"}
                    </Button>
                </Group>
                {save.isSuccess && (
                    <Text role="status" size="sm" c="dimmed">
                        Setup saved. Environment overrides, if present, still
                        apply.
                    </Text>
                )}
            </Stack>
            {refreshError && (
                <Alert color="red">
                    Setup was saved, but Azure DevOps could not be refreshed.
                    Check again from the sign-in screen or refresh Argus.
                </Alert>
            )}
        </Fieldset>
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
        <Stack gap="sm">
            <Text size="sm" fw={500}>
                Account
            </Text>
            <Text size="sm" c="dimmed">
                {auth.account
                    ? `Signed in as ${auth.account.username}`
                    : "Not signed in"}
            </Text>
            {auth.account && (
                <Group gap="sm">
                    <Button
                        variant="default"
                        type="button"

                        disabled={act.isPending}
                        loading={act.isPending && act.variables === "switch"}
                        onClick={() => act.mutate("switch")}
                    >
                        Switch account
                    </Button>
                    <Button
                        variant="default"
                        type="button"

                        disabled={act.isPending}
                        loading={act.isPending && act.variables === "out"}
                        onClick={() => act.mutate("out")}
                    >
                        Sign out
                    </Button>
                </Group>
            )}
            {act.error && (
                <Alert color="red" mt={4}>
                    {act.error.message}
                </Alert>
            )}
        </Stack>
    );
}
