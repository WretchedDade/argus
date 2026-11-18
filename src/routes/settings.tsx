import {
    ActionIcon,
    Affix,
    Button,
    Checkbox,
    Container,
    Divider,
    Fieldset,
    Group,
    Loader,
    Modal,
    NativeSelect,
    NumberInput,
    Paper,
    Radio,
    ScrollArea,
    SimpleGrid,
    Stack,
    Switch,
    Table,
    Tabs,
    Text,
    TextInput,
    Title,
} from "@mantine/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import {
    api,
    configApi,
    configQuery,
    repoScopesQuery,
    teamsQuery,
    versionQuery,
    type ArgusConfig,
} from "../lib/api";
import {
    AccountPanel,
    RegistrationImport,
    RegistrationShare,
} from "../components/AuthRegistration";
import {
    ErrorBanner,
    LoadErrorPage,
    PendingPage,
} from "../components/ErrorBanner";
import { TeamMultiSelect } from "../components/TeamMultiSelect";
import { TeamLabelEditor } from "../components/TeamLabelEditor";
import { pushToast } from "../lib/toast";
import { errorMessage } from "../lib/errors";
import { validateIntegerSetting } from "../lib/settings-form";
import { AppearanceSettings } from "../components/AppearanceSettings";

export const Route = createFileRoute("/settings")({
    loader: ({ context }) =>
        Promise.all([
            context.queryClient.ensureQueryData(configQuery),
            context.queryClient.ensureQueryData(teamsQuery),
        ]),
    component: Settings,
});

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REVIEW_MODES = [
    { id: "quick", label: "Review for me" },
    { id: "full", label: "Review with me" },
    { id: "automatic", label: "Delegate" },
] as const;
const GROUPS = [
    { id: "general", label: "General" },
    { id: "review", label: "Review" },
    { id: "ado", label: "Azure DevOps" },
    { id: "account", label: "Account" },
    { id: "appearance", label: "Appearance" },
    { id: "app", label: "System" },
] as const;
type GroupId = (typeof GROUPS)[number]["id"];

const trimModel = (model: { model: string; reasoningEffort: string }) => ({
    model: model.model.trim(),
    reasoningEffort: model.reasoningEffort.trim(),
});

function RepoScopeRow({
    repo,
}: {
    repo: Awaited<ReturnType<typeof api.repoScopes>>[number];
}) {
    const queryClient = useQueryClient();
    const change = useMutation({
        mutationFn: (scope: "out" | null) => api.setRepoScope(repo.repo, scope),
        onSuccess: async (result) => {
            const plural = (n: number) => `${n} PR${n === 1 ? "" : "s"}`;
            const parts = [
                result.archived > 0
                    ? `archived ${plural(result.archived)}`
                    : "",
                result.revived > 0 ? `restored ${plural(result.revived)}` : "",
                result.kept > 0
                    ? `${plural(result.kept)} still shown (you author or review by name)`
                    : "",
            ].filter(Boolean);
            pushToast(
                `${repo.repo}: ${parts.length ? parts.join(", ") : "no PRs changed"}`,
                "success",
                6000,
            );
            await queryClient.invalidateQueries();
        },
    });
    return (
        <Table.Tr>
            <Table.Td>
                <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                    {repo.repo}
                </Text>
                <Text size="sm" c="dimmed">
                    {repo.open} open · {repo.hidden} archived
                </Text>
            </Table.Td>
            <Table.Td w={160}>
                <NativeSelect
                    size="sm"
                    aria-label={`Scope for ${repo.repo}`}
                    aria-busy={change.isPending}
                    value={repo.scope === "out" ? "out" : "default"}
                    disabled={change.isPending}
                    rightSection={
                        change.isPending ? <Loader size="xs" /> : undefined
                    }
                    data={[
                        { value: "default", label: "In scope" },
                        { value: "out", label: "Out of scope" },
                    ]}
                    onChange={(event) =>
                        change.mutate(
                            event.currentTarget.value === "out" ? "out" : null,
                        )
                    }
                />
                {change.isError && (
                    <Text size="sm" c="red" role="alert" mt={4}>
                        {errorMessage(change.error)}
                    </Text>
                )}
            </Table.Td>
        </Table.Tr>
    );
}

function RepoScopePanel() {
    const repos = useQuery(repoScopesQuery);
    return (
        <Fieldset legend="Repository scope">
            <Stack gap="sm">
                <Text size="sm" c="dimmed">
                    Changes apply immediately. Out-of-scope PRs are archived,
                    unless you are their author or a named reviewer.
                </Text>
                {repos.isPending && (
                    <Loader size="sm" aria-label="Loading repositories" />
                )}
                {repos.isError && (
                    <ErrorBanner
                        title="Couldn't load repositories"
                        error={repos.error}
                        onRetry={() => void repos.refetch()}
                    />
                )}
                {repos.data && (
                    <Table.ScrollContainer minWidth={0}>
                        <Table verticalSpacing="sm">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Repository</Table.Th>
                                    <Table.Th>Scope</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {repos.data.map((repo) => (
                                    <RepoScopeRow key={repo.repo} repo={repo} />
                                ))}
                                {repos.data.length === 0 && (
                                    <Table.Tr>
                                        <Table.Td colSpan={2}>
                                            <Text size="sm" c="dimmed">
                                                No repositories yet.
                                            </Text>
                                        </Table.Td>
                                    </Table.Tr>
                                )}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                )}
            </Stack>
        </Fieldset>
    );
}

function Settings() {
    const config = useQuery(configQuery);
    if (config.isPending) return <PendingPage />;
    if (!config.data)
        return (
            <LoadErrorPage
                what="your settings"
                error={config.error}
                onRetry={() => void config.refetch()}
            />
        );
    return (
        <>
            {config.isError && (
                <ErrorBanner
                    title="Couldn't refresh settings"
                    error={config.error}
                    onRetry={() => void config.refetch()}
                />
            )}
            <SettingsForm config={config.data} />
        </>
    );
}

export function SettingsForm({ config: cfg }: { config: ArgusConfig }) {
    const qc = useQueryClient();
    const router = useRouter();
    const teams = useQuery(teamsQuery);
    const version = useQuery(versionQuery);
    const formId = useId();
    const formElement = useRef<HTMLFormElement>(null);
    const [tab, setTab] = useState<GroupId>("general");
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const deletion = useMutation({
        mutationFn: api.deleteAllData,
        onSuccess: async () => {
            await qc.invalidateQueries();
            setConfirmDelete(false);
            pushToast("All Argus data deleted");
        },
    });
    const check = useMutation({
        mutationFn: async () => {
            const result = await api.checkForUpdatesNow();
            if (!result.ok) throw new Error("Couldn't reach GitHub.");
            return result;
        },
        onSuccess: (result) => {
            pushToast(
                result.updateAvailable
                    ? `Version ${result.latest} is available. See the bell.`
                    : "You're up to date",
            );
            void qc.invalidateQueries({ queryKey: ["notices"] });
        },
    });

    const revealField = (input: HTMLElement) => {
        const group = input.closest<HTMLElement>("[data-group]");
        const nextTab = GROUPS.find(
            ({ id }) => id === group?.dataset.group,
        )?.id;
        if (nextTab && nextTab !== tab) flushSync(() => setTab(nextTab));
        input.focus();
    };

    const form = useForm({
        defaultValues: {
            me: cfg.me ?? "",
            adoAuth: cfg.adoAuth,
            project: cfg.project,
            orgUrl: cfg.orgUrl,
            orgSlug: cfg.orgSlug,
            teamPatterns: cfg.teamPatterns,
            teamLabels: cfg.teamLabels,
            periods: cfg.periods,
            reviewSkillName: cfg.reviewSkillName,
            reviewModels: cfg.reviewModels,
            recencyDays: String(cfg.recencyDays),
            retentionDays: String(cfg.retentionDays),
            workStartHour: String(cfg.workStartHour),
            workEndHour: String(cfg.workEndHour),
            workDays: cfg.workDays,
            checkForUpdates: cfg.checkForUpdates,
            vendorPattern: cfg.vendorPattern,
        },
        onSubmitInvalid: ({ formApi }) => {
            const invalid = Object.entries(formApi.state.fieldMeta).find(
                ([, meta]) => meta?.errors.length,
            );
            const input = invalid
                ? formElement.current?.elements.namedItem(invalid[0])
                : null;
            if (input instanceof HTMLElement) revealField(input);
        },
        onSubmit: async ({ value }) => {
            setSaveError(null);
            try {
                await configApi.save({
                    me: value.me.trim() || null,
                    adoAuth: value.adoAuth,
                    project: value.project.trim(),
                    orgUrl: value.orgUrl.trim(),
                    orgSlug: value.orgSlug.trim(),
                    teamPatterns: value.teamPatterns,
                    teamLabels: value.teamLabels,
                    periods: value.periods.filter(
                        (period) =>
                            period.label.trim() && period.start && period.end,
                    ),
                    reviewSkillName:
                        value.reviewSkillName.trim() || "pr-review",
                    reviewModels: {
                        quick: trimModel(value.reviewModels.quick),
                        full: trimModel(value.reviewModels.full),
                        automatic: trimModel(value.reviewModels.automatic),
                    },
                    recencyDays: Number(value.recencyDays),
                    retentionDays: Number(value.retentionDays),
                    workStartHour: Number(value.workStartHour),
                    workEndHour: Number(value.workEndHour),
                    workDays: value.workDays,
                    checkForUpdates: value.checkForUpdates,
                    vendorPattern: value.vendorPattern,
                });
            } catch (error) {
                const message = errorMessage(error);
                setSaveError(message);
                pushToast(`Couldn't save settings: ${message}`, "error");
                return;
            }
            for (const key of ["config", "prs", "all-prs", "health"])
                void qc.invalidateQueries({ queryKey: [key] });
            pushToast("Settings saved");
            void router.navigate({ to: "/" });
        },
    });

    return (
        <Container size="md" px={0} pb={120}>
            <Stack gap="lg">
                <Stack gap={4}>
                    <Title order={1} size="h3">
                        Settings
                    </Title>
                    <Text size="sm" c="dimmed">
                        Configure tracking and reviews. Save settings applies
                        changes across tabs.
                    </Text>
                </Stack>
                <form
                    id={formId}
                    ref={formElement}
                    onSubmit={(event) => {
                        event.preventDefault();
                        void form.handleSubmit();
                    }}
                    onInvalidCapture={(event) => {
                        const input = event.target;
                        if (!(input instanceof HTMLInputElement)) return;
                        const group =
                            input.closest<HTMLElement>("[data-group]");
                        if (!group || group.dataset.group === tab) return;
                        revealField(input);
                        input.reportValidity();
                    }}
                >
                    <Stack gap="md">
                        {saveError && (
                            <ErrorBanner
                                title="Couldn't save settings"
                                error={saveError}
                            />
                        )}
                        {/* Keep inactive fields registered for cross-tab validation. */}
                        <Tabs
                            value={tab}
                            keepMounted
                            keepMountedMode="display-none"
                            onChange={(value) => {
                                const next = GROUPS.find(
                                    ({ id }) => id === value,
                                );
                                if (next) setTab(next.id);
                            }}
                        >
                            <ScrollArea
                                type="auto"
                                offsetScrollbars
                                scrollbarSize={6}
                            >
                                <Tabs.List
                                    aria-label="Settings sections"
                                    style={{ flexWrap: "nowrap" }}
                                >
                                    {GROUPS.map((group) => (
                                        <Tabs.Tab
                                            key={group.id}
                                            value={group.id}
                                            style={{ whiteSpace: "nowrap" }}
                                        >
                                            {group.label}
                                        </Tabs.Tab>
                                    ))}
                                </Tabs.List>
                            </ScrollArea>
                            <Tabs.Panel
                                value="general"
                                data-group="general"
                                pt="lg"
                            >
                                <Stack gap="lg">
                                    <Fieldset legend="Schedule">
                                        <Stack gap="md">
                                            <SimpleGrid
                                                cols={{ base: 1, sm: 2 }}
                                            >
                                                <form.Field
                                                    name="workStartHour"
                                                    validators={{
                                                        onChange: ({ value }) =>
                                                            validateIntegerSetting(
                                                                value,
                                                                0,
                                                                23,
                                                            ),
                                                    }}
                                                >
                                                    {(field) => (
                                                        <NumberInput
                                                            label="Work start (hour)"
                                                            description="Local time, from 0 to 23."
                                                            name={field.name}
                                                            value={
                                                                field.state
                                                                    .value
                                                            }
                                                            onChange={(value) =>
                                                                field.handleChange(
                                                                    String(
                                                                        value,
                                                                    ),
                                                                )
                                                            }
                                                            onBlur={
                                                                field.handleBlur
                                                            }
                                                            error={field.state.meta.errors.join(
                                                                " ",
                                                            )}
                                                            min={0}
                                                            max={23}
                                                            withAsterisk
                                                            aria-required="true"
                                                            allowDecimal={false}
                                                            clampBehavior="none"
                                                            size="sm"
                                                        />
                                                    )}
                                                </form.Field>
                                                <form.Field
                                                    name="workEndHour"
                                                    validators={{
                                                        onChange: ({ value }) =>
                                                            validateIntegerSetting(
                                                                value,
                                                                0,
                                                                23,
                                                            ),
                                                    }}
                                                >
                                                    {(field) => (
                                                        <NumberInput
                                                            label="Work end (hour)"
                                                            description="Local time, from 0 to 23."
                                                            name={field.name}
                                                            value={
                                                                field.state
                                                                    .value
                                                            }
                                                            onChange={(value) =>
                                                                field.handleChange(
                                                                    String(
                                                                        value,
                                                                    ),
                                                                )
                                                            }
                                                            onBlur={
                                                                field.handleBlur
                                                            }
                                                            error={field.state.meta.errors.join(
                                                                " ",
                                                            )}
                                                            min={0}
                                                            max={23}
                                                            withAsterisk
                                                            aria-required="true"
                                                            allowDecimal={false}
                                                            clampBehavior="none"
                                                            size="sm"
                                                        />
                                                    )}
                                                </form.Field>
                                            </SimpleGrid>
                                            <form.Field name="workDays">
                                                {(field) => (
                                                    <Checkbox.Group
                                                        label="Work days"
                                                        value={field.state.value.map(
                                                            String,
                                                        )}
                                                        onChange={(values) =>
                                                            field.handleChange(
                                                                values
                                                                    .map(Number)
                                                                    .sort(
                                                                        (
                                                                            a,
                                                                            b,
                                                                        ) =>
                                                                            a -
                                                                            b,
                                                                    ),
                                                            )
                                                        }
                                                    >
                                                        <Group mt="xs" gap="sm">
                                                            {DAYS.map(
                                                                (
                                                                    day,
                                                                    index,
                                                                ) => (
                                                                    <Checkbox
                                                                        key={
                                                                            day
                                                                        }
                                                                        value={String(
                                                                            index,
                                                                        )}
                                                                        label={
                                                                            day
                                                                        }
                                                                        onBlur={
                                                                            field.handleBlur
                                                                        }
                                                                    />
                                                                ),
                                                            )}
                                                        </Group>
                                                    </Checkbox.Group>
                                                )}
                                            </form.Field>
                                        </Stack>
                                    </Fieldset>
                                    <Fieldset legend="People">
                                        <form.Field name="vendorPattern">
                                            {(field) => (
                                                <TextInput
                                                    label="Vendor name pattern"
                                                    description="A regular expression. A matching display name counts as a vendor. Leave empty to turn the rule off."
                                                    placeholder="\(.+\)"
                                                    name={field.name}
                                                    value={field.state.value}
                                                    onBlur={field.handleBlur}
                                                    onChange={(event) =>
                                                        field.handleChange(
                                                            event.currentTarget
                                                                .value,
                                                        )
                                                    }
                                                    error={field.state.meta.errors.join(
                                                        " ",
                                                    )}
                                                />
                                            )}
                                        </form.Field>
                                    </Fieldset>
                                    <Fieldset legend="Context bands">
                                        <Stack gap="md">
                                            <Text size="sm" c="dimmed">
                                                Named periods shade the Load
                                                &amp; capacity chart, such as a
                                                hackathon, team week, or time
                                                off.
                                            </Text>
                                            <form.Field
                                                name="periods"
                                                mode="array"
                                            >
                                                {(field) => (
                                                    <Stack gap="md">
                                                        {field.state.value.map(
                                                            (_, index) => (
                                                                <SimpleGrid
                                                                    key={index}
                                                                    cols={{
                                                                        base: 1,
                                                                        sm: 3,
                                                                    }}
                                                                    spacing="sm"
                                                                >
                                                                    <form.Field
                                                                        name={`periods[${index}].label`}
                                                                    >
                                                                        {(
                                                                            period,
                                                                        ) => (
                                                                            <TextInput
                                                                                label="Label"
                                                                                aria-label={`Period ${index + 1} label`}
                                                                                name={
                                                                                    period.name
                                                                                }
                                                                                value={
                                                                                    period
                                                                                        .state
                                                                                        .value
                                                                                }
                                                                                onBlur={
                                                                                    period.handleBlur
                                                                                }
                                                                                onChange={(
                                                                                    event,
                                                                                ) =>
                                                                                    period.handleChange(
                                                                                        event
                                                                                            .currentTarget
                                                                                            .value,
                                                                                    )
                                                                                }
                                                                            />
                                                                        )}
                                                                    </form.Field>
                                                                    <form.Field
                                                                        name={`periods[${index}].start`}
                                                                    >
                                                                        {(
                                                                            period,
                                                                        ) => (
                                                                            <TextInput
                                                                                type="date"
                                                                                label="Start"
                                                                                aria-label={`Period ${index + 1} start`}
                                                                                name={
                                                                                    period.name
                                                                                }
                                                                                value={
                                                                                    period
                                                                                        .state
                                                                                        .value
                                                                                }
                                                                                onBlur={
                                                                                    period.handleBlur
                                                                                }
                                                                                onChange={(
                                                                                    event,
                                                                                ) =>
                                                                                    period.handleChange(
                                                                                        event
                                                                                            .currentTarget
                                                                                            .value,
                                                                                    )
                                                                                }
                                                                            />
                                                                        )}
                                                                    </form.Field>
                                                                    <Group
                                                                        align="flex-end"
                                                                        wrap="nowrap"
                                                                        gap="xs"
                                                                    >
                                                                        <form.Field
                                                                            name={`periods[${index}].end`}
                                                                        >
                                                                            {(
                                                                                period,
                                                                            ) => (
                                                                                <TextInput
                                                                                    type="date"
                                                                                    label="End"
                                                                                    aria-label={`Period ${index + 1} end`}
                                                                                    name={
                                                                                        period.name
                                                                                    }
                                                                                    value={
                                                                                        period
                                                                                            .state
                                                                                            .value
                                                                                    }
                                                                                    flex={
                                                                                        1
                                                                                    }
                                                                                    miw={
                                                                                        0
                                                                                    }
                                                                                    onBlur={
                                                                                        period.handleBlur
                                                                                    }
                                                                                    onChange={(
                                                                                        event,
                                                                                    ) =>
                                                                                        period.handleChange(
                                                                                            event
                                                                                                .currentTarget
                                                                                                .value,
                                                                                        )
                                                                                    }
                                                                                />
                                                                            )}
                                                                        </form.Field>
                                                                        <ActionIcon
                                                                            size="input-sm"
                                                                            variant="default"
                                                                            aria-label={`Remove period ${index + 1}`}
                                                                            onClick={() =>
                                                                                void field.removeValue(
                                                                                    index,
                                                                                )
                                                                            }
                                                                        >
                                                                            <X
                                                                                size={
                                                                                    16
                                                                                }
                                                                            />
                                                                        </ActionIcon>
                                                                    </Group>
                                                                </SimpleGrid>
                                                            ),
                                                        )}
                                                        <Group>
                                                            <Button
                                                                type="button"
                                                                variant="default"
                                                                leftSection={
                                                                    <Plus
                                                                        size={
                                                                            16
                                                                        }
                                                                    />
                                                                }
                                                                onClick={() =>
                                                                    field.pushValue(
                                                                        {
                                                                            label: "",
                                                                            start: "",
                                                                            end: "",
                                                                        },
                                                                    )
                                                                }
                                                            >
                                                                Add period
                                                            </Button>
                                                        </Group>
                                                    </Stack>
                                                )}
                                            </form.Field>
                                        </Stack>
                                    </Fieldset>
                                </Stack>
                            </Tabs.Panel>
                            <Tabs.Panel
                                value="review"
                                data-group="review"
                                pt="lg"
                            >
                                <Stack gap="lg">
                                    <form.Field name="reviewSkillName">
                                        {(field) => (
                                            <TextInput
                                                label="Review skill"
                                                description="The skill the Review buttons tell the agent to run. Default: pr-review."
                                                placeholder="pr-review"
                                                name={field.name}
                                                value={field.state.value}
                                                onBlur={field.handleBlur}
                                                onChange={(event) =>
                                                    field.handleChange(
                                                        event.currentTarget
                                                            .value,
                                                    )
                                                }
                                                error={field.state.meta.errors.join(
                                                    " ",
                                                )}
                                            />
                                        )}
                                    </form.Field>
                                    <Text size="sm" c="dimmed">
                                        Model and reasoning effort are optional.
                                        Leave either empty to use the host
                                        default. Available models depend on your
                                        host and account.
                                    </Text>
                                    {REVIEW_MODES.map((mode) => (
                                        <Fieldset
                                            key={mode.id}
                                            legend={mode.label}
                                        >
                                            <SimpleGrid
                                                cols={{ base: 1, sm: 2 }}
                                            >
                                                <form.Field
                                                    name={`reviewModels.${mode.id}.model`}
                                                >
                                                    {(field) => (
                                                        <TextInput
                                                            label="Model ID"
                                                            description="Examples: gpt-5.3-codex, claude-sonnet-5.5."
                                                            aria-label={`${mode.label} model ID`}
                                                            placeholder="Host default"
                                                            name={field.name}
                                                            value={
                                                                field.state
                                                                    .value
                                                            }
                                                            onBlur={
                                                                field.handleBlur
                                                            }
                                                            onChange={(event) =>
                                                                field.handleChange(
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                )
                                                            }
                                                            error={field.state.meta.errors.join(
                                                                " ",
                                                            )}
                                                        />
                                                    )}
                                                </form.Field>
                                                <form.Field
                                                    name={`reviewModels.${mode.id}.reasoningEffort`}
                                                >
                                                    {(field) => (
                                                        <TextInput
                                                            label="Reasoning effort"
                                                            description="Examples: low, medium, high. Supported values depend on the model."
                                                            aria-label={`${mode.label} reasoning effort`}
                                                            placeholder="Host default"
                                                            name={field.name}
                                                            value={
                                                                field.state
                                                                    .value
                                                            }
                                                            onBlur={
                                                                field.handleBlur
                                                            }
                                                            onChange={(event) =>
                                                                field.handleChange(
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                )
                                                            }
                                                            error={field.state.meta.errors.join(
                                                                " ",
                                                            )}
                                                        />
                                                    )}
                                                </form.Field>
                                            </SimpleGrid>
                                        </Fieldset>
                                    ))}
                                </Stack>
                            </Tabs.Panel>
                            <Tabs.Panel value="ado" data-group="ado" pt="lg">
                                <Stack gap="lg">
                                    <Fieldset legend="Connection">
                                        <Stack gap="md">
                                            <form.Field name="orgUrl">
                                                {(field) => (
                                                    <TextInput
                                                        label="Organization URL"
                                                        name={field.name}
                                                        value={
                                                            field.state.value
                                                        }
                                                        onBlur={
                                                            field.handleBlur
                                                        }
                                                        onChange={(event) =>
                                                            field.handleChange(
                                                                event
                                                                    .currentTarget
                                                                    .value,
                                                            )
                                                        }
                                                        error={field.state.meta.errors.join(
                                                            " ",
                                                        )}
                                                    />
                                                )}
                                            </form.Field>
                                            <SimpleGrid
                                                cols={{ base: 1, sm: 2 }}
                                            >
                                                <form.Field name="orgSlug">
                                                    {(field) => (
                                                        <TextInput
                                                            label="Organization slug"
                                                            name={field.name}
                                                            value={
                                                                field.state
                                                                    .value
                                                            }
                                                            onBlur={
                                                                field.handleBlur
                                                            }
                                                            onChange={(event) =>
                                                                field.handleChange(
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                )
                                                            }
                                                            error={field.state.meta.errors.join(
                                                                " ",
                                                            )}
                                                        />
                                                    )}
                                                </form.Field>
                                                <form.Field name="project">
                                                    {(field) => (
                                                        <TextInput
                                                            label="Project"
                                                            name={field.name}
                                                            value={
                                                                field.state
                                                                    .value
                                                            }
                                                            onBlur={
                                                                field.handleBlur
                                                            }
                                                            onChange={(event) =>
                                                                field.handleChange(
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                )
                                                            }
                                                            error={field.state.meta.errors.join(
                                                                " ",
                                                            )}
                                                        />
                                                    )}
                                                </form.Field>
                                            </SimpleGrid>
                                        </Stack>
                                    </Fieldset>
                                    {teams.isError && (
                                        <ErrorBanner
                                            title="Couldn't load teams"
                                            error={teams.error}
                                            onRetry={() => void teams.refetch()}
                                        />
                                    )}
                                    <form.Field name="teamPatterns">
                                        {(field) => (
                                            <TeamMultiSelect
                                                value={field.state.value}
                                                options={teams.data ?? []}
                                                onChange={field.handleChange}
                                                onBlur={field.handleBlur}
                                            />
                                        )}
                                    </form.Field>
                                    <Fieldset legend="Team labels">
                                        <Stack gap="sm">
                                            <Text size="sm" c="dimmed">
                                                Friendly names for team badges.
                                                These do not change which teams
                                                you track.
                                            </Text>
                                            <form.Field name="teamLabels">
                                                {(field) => (
                                                    <TeamLabelEditor
                                                        value={
                                                            field.state.value
                                                        }
                                                        options={
                                                            teams.data ?? []
                                                        }
                                                        onChange={
                                                            field.handleChange
                                                        }
                                                        onBlur={
                                                            field.handleBlur
                                                        }
                                                    />
                                                )}
                                            </form.Field>
                                        </Stack>
                                    </Fieldset>
                                    <RepoScopePanel />
                                </Stack>
                            </Tabs.Panel>
                            <Tabs.Panel
                                value="account"
                                data-group="account"
                                pt="lg"
                            >
                                <Stack gap="lg">
                                    <Fieldset legend="Identity">
                                        <Stack gap="md">
                                            <form.Field name="adoAuth">
                                                {(field) => (
                                                    <Radio.Group
                                                        label="Sign-in method"
                                                        description="Applies when you save settings. No restart is needed."
                                                        value={
                                                            field.state.value
                                                        }
                                                        onChange={(value) => {
                                                            if (
                                                                value ===
                                                                    "az" ||
                                                                value ===
                                                                    "broker"
                                                            )
                                                                field.handleChange(
                                                                    value,
                                                                );
                                                        }}
                                                    >
                                                        <Stack gap="sm" mt="sm">
                                                            <Radio
                                                                value="az"
                                                                label="Azure CLI"
                                                                description="Use your az login."
                                                                onBlur={
                                                                    field.handleBlur
                                                                }
                                                            />
                                                            <Radio
                                                                value="broker"
                                                                label="Windows account"
                                                                description="Use the Windows account broker. Requires the Entra app setup below (Windows only)."
                                                                onBlur={
                                                                    field.handleBlur
                                                                }
                                                            />
                                                        </Stack>
                                                    </Radio.Group>
                                                )}
                                            </form.Field>
                                            <AccountPanel />
                                            <form.Field name="me">
                                                {(field) => (
                                                    <TextInput
                                                        label="Account email override"
                                                        description="Leave blank to use the signed-in Azure DevOps account."
                                                        placeholder="Auto-detect"
                                                        name={field.name}
                                                        value={
                                                            field.state.value
                                                        }
                                                        onBlur={
                                                            field.handleBlur
                                                        }
                                                        onChange={(event) =>
                                                            field.handleChange(
                                                                event
                                                                    .currentTarget
                                                                    .value,
                                                            )
                                                        }
                                                        error={field.state.meta.errors.join(
                                                            " ",
                                                        )}
                                                    />
                                                )}
                                            </form.Field>
                                        </Stack>
                                    </Fieldset>
                                    <Divider />
                                    <RegistrationImport />
                                    <RegistrationShare />
                                </Stack>
                            </Tabs.Panel>
                            <Tabs.Panel
                                value="appearance"
                                data-group="appearance"
                                pt="lg"
                            >
                                <AppearanceSettings />
                            </Tabs.Panel>
                            <Tabs.Panel value="app" data-group="app" pt="lg">
                                <Stack gap="lg">
                                    <Fieldset legend="Updates">
                                        <Stack gap="md">
                                            {version.isError && (
                                                <ErrorBanner
                                                    title="Couldn't load the app version"
                                                    error={version.error}
                                                    onRetry={() =>
                                                        void version.refetch()
                                                    }
                                                />
                                            )}
                                            <Group justify="space-between">
                                                <Text size="sm">
                                                    {version.data
                                                        ? `Argus v${version.data}`
                                                        : "Argus"}
                                                </Text>
                                                <Button
                                                    type="button"
                                                    variant="default"
                                                    loading={check.isPending}
                                                    disabled={
                                                        !cfg.checkForUpdates
                                                    }
                                                    title={
                                                        cfg.checkForUpdates
                                                            ? undefined
                                                            : "Save settings with update checks enabled to use this"
                                                    }
                                                    onClick={() =>
                                                        check.mutate()
                                                    }
                                                >
                                                    Check for updates
                                                </Button>
                                            </Group>
                                            {check.isError && (
                                                <ErrorBanner
                                                    title="Couldn't check for updates"
                                                    error={
                                                        errorMessage(
                                                            check.error,
                                                        ) === "off"
                                                            ? "Update checks are turned off."
                                                            : check.error
                                                    }
                                                />
                                            )}
                                            <form.Field name="checkForUpdates">
                                                {(field) => (
                                                    <Switch
                                                        label="Check for new versions"
                                                        description="Check GitHub once a day and show new releases in the bell. No data about you is sent. Save settings applies this change."
                                                        checked={
                                                            field.state.value
                                                        }
                                                        onBlur={
                                                            field.handleBlur
                                                        }
                                                        onChange={(event) =>
                                                            field.handleChange(
                                                                event
                                                                    .currentTarget
                                                                    .checked,
                                                            )
                                                        }
                                                    />
                                                )}
                                            </form.Field>
                                        </Stack>
                                    </Fieldset>
                                    <Fieldset legend="Discovery and logs">
                                        <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                            <form.Field
                                                name="recencyDays"
                                                validators={{
                                                    onChange: ({ value }) =>
                                                        validateIntegerSetting(
                                                            value,
                                                            1,
                                                        ),
                                                }}
                                            >
                                                {(field) => (
                                                    <NumberInput
                                                        label="Recency (days)"
                                                        description="Auto-add untracked PRs newer than this."
                                                        name={field.name}
                                                        value={
                                                            field.state.value
                                                        }
                                                        onChange={(value) =>
                                                            field.handleChange(
                                                                String(value),
                                                            )
                                                        }
                                                        onBlur={
                                                            field.handleBlur
                                                        }
                                                        error={field.state.meta.errors.join(
                                                            " ",
                                                        )}
                                                        min={1}
                                                        withAsterisk
                                                        aria-required="true"
                                                        allowDecimal={false}
                                                        clampBehavior="none"
                                                        size="sm"
                                                    />
                                                )}
                                            </form.Field>
                                            <form.Field
                                                name="retentionDays"
                                                validators={{
                                                    onChange: ({ value }) =>
                                                        validateIntegerSetting(
                                                            value,
                                                            1,
                                                        ),
                                                }}
                                            >
                                                {(field) => (
                                                    <NumberInput
                                                        label="Log retention (days)"
                                                        description="How long Argus keeps activity logs."
                                                        name={field.name}
                                                        value={
                                                            field.state.value
                                                        }
                                                        onChange={(value) =>
                                                            field.handleChange(
                                                                String(value),
                                                            )
                                                        }
                                                        onBlur={
                                                            field.handleBlur
                                                        }
                                                        error={field.state.meta.errors.join(
                                                            " ",
                                                        )}
                                                        min={1}
                                                        withAsterisk
                                                        aria-required="true"
                                                        allowDecimal={false}
                                                        clampBehavior="none"
                                                        size="sm"
                                                    />
                                                )}
                                            </form.Field>
                                        </SimpleGrid>
                                    </Fieldset>
                                    <Fieldset legend="Your data">
                                        <Stack gap="md">
                                            <Text size="sm">
                                                Argus keeps PR titles, people
                                                names, votes, and review history
                                                on this computer. Deleting this
                                                data keeps your settings. Open
                                                PRs return from Azure DevOps on
                                                the next poll, but deleted
                                                history cannot be recovered.
                                            </Text>
                                            <Group>
                                                <Button
                                                    type="button"
                                                    variant="light"
                                                    color="red"
                                                    onClick={() => {
                                                        deletion.reset();
                                                        setConfirmDelete(true);
                                                    }}
                                                >
                                                    Delete all data
                                                </Button>
                                            </Group>
                                        </Stack>
                                    </Fieldset>
                                </Stack>
                            </Tabs.Panel>
                        </Tabs>
                    </Stack>
                    <form.Subscribe
                        selector={(state) => ({
                            isDirty: state.isDirty,
                            isSubmitting: state.isSubmitting,
                        })}
                    >
                        {({ isDirty, isSubmitting }) =>
                            isDirty ? (
                                <Affix
                                    position={{
                                        bottom: 16,
                                        left: 16,
                                        right: 16,
                                    }}
                                    withinPortal={false}
                                >
                                    <Container size="md" px={0}>
                                        <Paper withBorder p="sm" shadow="sm">
                                            <Group
                                                justify="space-between"
                                                gap="sm"
                                            >
                                                <Text size="sm" role="status">
                                                    Unsaved settings
                                                </Text>
                                                <Group gap="sm">
                                                    <Button
                                                        type="button"
                                                        variant="default"
                                                        disabled={isSubmitting}
                                                        onClick={() => {
                                                            form.reset();
                                                            setSaveError(null);
                                                        }}
                                                    >
                                                        Reset
                                                    </Button>
                                                    <Button
                                                        type="submit"
                                                        form={formId}
                                                        loading={isSubmitting}
                                                    >
                                                        Save settings
                                                    </Button>
                                                </Group>
                                            </Group>
                                        </Paper>
                                    </Container>
                                </Affix>
                            ) : null
                        }
                    </form.Subscribe>
                </form>
            </Stack>
            <Modal
                opened={confirmDelete}
                title="Delete all Argus data?"
                onClose={() => {
                    if (!deletion.isPending) setConfirmDelete(false);
                }}
                closeOnClickOutside={!deletion.isPending}
                closeOnEscape={!deletion.isPending}
                withCloseButton={!deletion.isPending}
                centered
            >
                <Stack gap="md">
                    <Text size="sm">
                        This permanently deletes PR data and review history from
                        this computer. Your settings stay. Open PRs return on
                        the next poll, but their old history does not.
                    </Text>
                    {deletion.isError && (
                        <ErrorBanner
                            title="Couldn't delete the data"
                            error={deletion.error}
                        />
                    )}
                    <Group justify="flex-end">
                        <Button
                            type="button"
                            variant="default"
                            data-autofocus
                            disabled={deletion.isPending}
                            onClick={() => setConfirmDelete(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            color="red"
                            loading={deletion.isPending}
                            onClick={() => deletion.mutate()}
                        >
                            Delete all data
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Container>
    );
}
