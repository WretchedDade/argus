import { NativeSelect } from "@mantine/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Checkbox,
    Group as ControlGroup,
    NavLink,
    TextInput,
} from "@mantine/core";
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
import { SegToggle } from "../components/SegToggle";
import { TeamMultiSelect } from "../components/TeamMultiSelect";
import { TeamLabelEditor } from "../components/TeamLabelEditor";
import { pushToast } from "../lib/toast";
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

// Out-of-scope repos are archived. You still see PRs you author or review by name.
function RepoScopePanel() {
    const queryClient = useQueryClient();
    const repos = useQuery(repoScopesQuery).data ?? [];
    const change = async (repo: string, value: string) => {
        try {
            const r = await api.setRepoScope(
                repo,
                value === "default" ? null : (value as "in" | "out"),
            );
            const plural = (n: number) => `${n} PR${n === 1 ? "" : "s"}`;
            const parts = [
                r.archived > 0 ? `archived ${plural(r.archived)}` : "",
                r.revived > 0 ? `restored ${plural(r.revived)}` : "",
                r.kept > 0
                    ? `${plural(r.kept)} still shown (you author or review by name)`
                    : "",
            ].filter(Boolean);
            pushToast(
                `${repo}: ${parts.length ? parts.join(", ") : "no PRs changed"}`,
                "success",
                6000,
            );
            await queryClient.invalidateQueries();
        } catch (err) {
            pushToast(`Could not change scope: ${String(err)}`, "error");
        }
    };
    return (
        <section className="flex flex-col gap-3">
            <h2 className="text-muted text-xs font-medium uppercase tracking-wide">
                Repo scope
            </h2>
            <p className="text-muted text-xs">
                PRs in an out-of-scope repo are archived. A PR still shows if
                you are its author or a named reviewer.
            </p>
            {repos.length === 0 ? (
                <p className="text-muted text-xs">No repos yet.</p>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-muted text-left text-xs">
                            <th className="py-1 font-medium">Repo</th>
                            <th className="py-1 font-medium">Open</th>
                            <th className="py-1 font-medium">Archived</th>
                            <th className="py-1 text-right font-medium">
                                Scope
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {repos.map((r) => (
                            <tr key={r.repo} className="border-line border-t">
                                <td className="text-fg py-1.5 pr-3">
                                    {r.repo}
                                </td>
                                <td className="text-muted py-1.5 pr-3 text-xs tabular-nums">
                                    {r.open}
                                </td>
                                <td className="text-muted py-1.5 pr-3 text-xs tabular-nums">
                                    {r.hidden}
                                </td>
                                <td className="py-1.5 text-right">
                                    <NativeSelect
                                        aria-label={`Scope for ${r.repo}`}

                                        value={r.scope ?? "default"}
                                        onChange={(e) =>
                                            void change(r.repo, e.target.value)
                                        }
                                    >
                                        <option value="default">
                                            In scope
                                        </option>
                                        <option value="out">
                                            Out of scope
                                        </option>
                                    </NativeSelect>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

function Row({
    label,
    hint,
    children,
    group = false,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
    group?: boolean;
}) {
    const Wrapper = group ? "fieldset" : "label";
    const Heading = group ? "legend" : "span";
    return (
        <Wrapper className="block min-w-0">
            <Heading className="text-fg text-sm font-medium">{label}</Heading>
            {children}
            {hint && <div className="text-muted mt-1 text-xs">{hint}</div>}
        </Wrapper>
    );
}

const trimModel = (m: { model: string; reasoningEffort: string }) => ({
    model: m.model.trim(),
    reasoningEffort: m.reasoningEffort.trim(),
});

const REVIEW_MODES = [
    { id: "quick", label: "Review for me" },
    { id: "full", label: "Review with me" },
    { id: "automatic", label: "Delegate" },
] as const;

const GROUPS = [
    { id: "general", label: "General" },
    { id: "appearance", label: "Appearance" },
    { id: "review", label: "Review" },
    { id: "account", label: "Account" },
    { id: "ado", label: "Azure DevOps" },
    { id: "app", label: "System" },
] as const;
type GroupId = (typeof GROUPS)[number]["id"];

// Hidden, not unmounted, so one form still saves every group.
function Group({
    id,
    active,
    children,
}: {
    id: GroupId;
    active: GroupId;
    children: React.ReactNode;
}) {
    return (
        <div
            data-group={id}
            hidden={id !== active}
            className="flex flex-col gap-6"
        >
            {children}
        </div>
    );
}

function Settings() {
    const qc = useQueryClient();
    const router = useRouter();
    const cfg = useQuery(configQuery).data as ArgusConfig;
    const teamOptions = useQuery(teamsQuery).data ?? [];
    const version = useQuery(versionQuery).data;
    const [checking, setChecking] = useState(false);
    const [tab, setTab] = useState<GroupId>("general");
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const deleteAll = async () => {
        setDeleting(true);
        try {
            await api.deleteAllData();
            await qc.invalidateQueries();
            pushToast("All Argus data deleted");
        } catch {
            pushToast("Couldn't delete the data", "error");
        } finally {
            setDeleting(false);
            setConfirmDelete(false);
        }
    };

    const checkNow = async () => {
        setChecking(true);
        try {
            const r = await api.checkForUpdatesNow();
            if (!r.ok) pushToast("Couldn't reach GitHub", "error");
            else if (r.updateAvailable)
                pushToast(`Version ${r.latest} is available. See the bell.`);
            else pushToast("You're up to date");
            void qc.invalidateQueries({ queryKey: ["notices"] });
        } catch (err) {
            pushToast(
                (err as Error).message === "off"
                    ? "Update checks are turned off"
                    : "Couldn't check for updates",
                "error",
            );
        } finally {
            setChecking(false);
        }
    };

    const form = useForm({
        defaultValues: {
            me: cfg.me ?? "",
            adoAuth: cfg.adoAuth ?? "az",
            avatarUrl: cfg.avatarUrl ?? "",
            project: cfg.project,
            orgUrl: cfg.orgUrl,
            orgSlug: cfg.orgSlug,
            teamPatterns: cfg.teamPatterns,
            teamLabels: cfg.teamLabels,
            periods: cfg.periods ?? [],
            reviewSkillName: cfg.reviewSkillName ?? "pr-review",
            reviewModels: cfg.reviewModels ?? {
                quick: { model: "", reasoningEffort: "" },
                full: { model: "", reasoningEffort: "" },
                automatic: { model: "", reasoningEffort: "" },
            },
            recencyDays: cfg.recencyDays,
            retentionDays: cfg.retentionDays,
            workStartHour: String(cfg.workStartHour),
            workEndHour: String(cfg.workEndHour),
            workDays: cfg.workDays,
            checkForUpdates: cfg.checkForUpdates ?? true,
            vendorPattern: cfg.vendorPattern ?? "\\(.+\\)",
        },
        onSubmit: async ({ value }) => {
            try {
                await configApi.save({
                    me: value.me.trim() || null,
                    adoAuth: value.adoAuth,
                    avatarUrl: value.avatarUrl.trim(),
                    project: value.project.trim(),
                    orgUrl: value.orgUrl.trim(),
                    orgSlug: value.orgSlug.trim(),
                    teamPatterns: value.teamPatterns,
                    teamLabels: value.teamLabels,
                    periods: value.periods.filter(
                        (p) => p.label.trim() && p.start && p.end,
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
            } catch (err) {
                pushToast(
                    `Couldn't save settings: ${(err as Error).message}`,
                    "error",
                );
                return;
            }
            for (const key of ["config", "prs", "health"])
                void qc.invalidateQueries({ queryKey: [key] });
            pushToast("Settings saved");
            void router.navigate({ to: "/" });
        },
    });

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                void form.handleSubmit();
            }}
            onInvalidCapture={(e) => {
                const input = e.target as HTMLInputElement;
                const group = input.closest<HTMLElement>("[data-group]");
                if (!group?.hidden) return;
                flushSync(() => setTab(group.dataset.group as GroupId));
                input.reportValidity();
            }}
            className="mx-auto flex max-w-3xl flex-col gap-5 pb-24"
        >
            <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
                <nav className="flex shrink-0 gap-1 overflow-x-auto sm:w-36 sm:flex-col">
                    {GROUPS.map((g) => (
                        <NavLink
                            key={g.id}
                            component="button"
                            type="button"
                            label={g.label}
                            w={{ base: "auto", sm: "100%" }}
                            active={tab === g.id}
                            aria-current={tab === g.id ? "true" : undefined}
                            onClick={() => setTab(g.id)}
                            className="shrink-0 whitespace-nowrap rounded-md"
                        />
                    ))}
                </nav>
                <div className="min-w-0 flex-1">
                    <Group id="appearance" active={tab}>
                        <AppearanceSettings />
                    </Group>
                    <Group id="account" active={tab}>
                        <section className="flex flex-col gap-3">
                            <h2 className="text-muted text-xs font-medium uppercase tracking-wide">
                                Identity
                            </h2>
                            <form.Field name="adoAuth">
                                {(field) => (
                                    <div>
                                        <div className="text-fg text-sm font-medium">
                                            Sign-in method
                                        </div>
                                        <div className="mt-1">
                                            <SegToggle
                                                value={field.state.value}
                                                onChange={field.handleChange}
                                                options={[
                                                    {
                                                        v: "az",
                                                        label: "Azure CLI",
                                                    },
                                                    {
                                                        v: "broker",
                                                        label: "Windows account",
                                                    },
                                                ]}
                                            />
                                        </div>
                                        <div className="text-muted mt-1 text-xs">
                                            Azure CLI uses your az login.
                                            Windows account uses the Windows
                                            account broker and needs an Entra
                                            app registration (Windows only).
                                            Applies without a restart.
                                        </div>
                                    </div>
                                )}
                            </form.Field>
                            <AccountPanel />
                            <RegistrationImport />
                            <RegistrationShare />
                            <form.Field name="me">
                                {(field) => (
                                    <Row
                                        label="Me"
                                        hint="Your ADO account email. Leave blank to use the signed-in account."
                                    >
                                        <TextInput
                                            placeholder="auto-detect"
                                            value={field.state.value}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                            <form.Field name="avatarUrl">
                                {(field) => (
                                    <Row
                                        label="Avatar image"
                                        hint="Optional image URL shown for your own PRs (e.g. a photo). Falls back to initials."
                                    >
                                        <TextInput
                                            placeholder="https://…/me.jpg"
                                            value={field.state.value}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                        </section>
                    </Group>

                    <Group id="ado" active={tab}>
                        <section className="grid grid-cols-2 gap-3">
                            <h2 className="text-muted col-span-2 text-xs font-medium uppercase tracking-wide">
                                Azure DevOps
                            </h2>
                            <form.Field name="project">
                                {(field) => (
                                    <Row label="Project">
                                        <TextInput
                                            value={field.state.value}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                            <form.Field name="orgSlug">
                                {(field) => (
                                    <Row label="Org slug">
                                        <TextInput
                                            value={field.state.value}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                            <form.Field name="orgUrl">
                                {(field) => (
                                    <Row label="Org URL">
                                        <TextInput
                                            value={field.state.value}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                        </section>
                        <section className="flex flex-col gap-3">
                            <h2 className="text-muted text-xs font-medium uppercase tracking-wide">
                                Teams
                            </h2>
                            <form.Field name="teamPatterns">
                                {(field) => (
                                    <TeamMultiSelect
                                        value={field.state.value}
                                        options={teamOptions}
                                        onChange={field.handleChange}
                                        onBlur={field.handleBlur}
                                    />
                                )}
                            </form.Field>
                            <form.Field name="teamLabels">
                                {(field) => (
                                    <Row
                                        label="Team labels"
                                        group
                                        hint="Friendly names for team chips. Independent of tracking above."
                                    >
                                        <TeamLabelEditor
                                            value={field.state.value}
                                            options={teamOptions}
                                            onChange={(v) =>
                                                field.handleChange(v)
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                        </section>
                        <RepoScopePanel />
                    </Group>

                    <Group id="review" active={tab}>
                        <section className="flex flex-col gap-3">
                            <h2 className="text-muted text-xs font-medium uppercase tracking-wide">
                                Review
                            </h2>
                            <form.Field name="reviewSkillName">
                                {(field) => (
                                    <Row
                                        label="Review skill"
                                        hint="The skill the Review buttons tell the agent to run. Default: pr-review."
                                    >
                                        <TextInput
                                            placeholder="pr-review"
                                            value={field.state.value}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                            {REVIEW_MODES.map((mode) => (
                                <form.Field
                                    key={mode.id}
                                    name={`reviewModels.${mode.id}`}
                                >
                                    {(field) => (
                                        <Row
                                            label={`${mode.label}: model and reasoning effort`}
                                            hint="Both optional. Leave a field empty to use the default."
                                        >
                                            <div className="flex gap-2">
                                                <TextInput
                                                    aria-label={`${mode.label} model ID`}
                                                    placeholder="Model ID"
                                                    value={
                                                        field.state.value.model
                                                    }
                                                    onChange={(e) =>
                                                        field.handleChange({
                                                            ...field.state
                                                                .value,
                                                            model: e.target
                                                                .value,
                                                        })
                                                    }
                                                />
                                                <TextInput
                                                    aria-label={`${mode.label} reasoning effort`}
                                                    placeholder="Effort (low, medium, high)"
                                                    value={
                                                        field.state.value
                                                            .reasoningEffort
                                                    }
                                                    onChange={(e) =>
                                                        field.handleChange({
                                                            ...field.state
                                                                .value,
                                                            reasoningEffort:
                                                                e.target.value,
                                                        })
                                                    }
                                                />
                                            </div>
                                        </Row>
                                    )}
                                </form.Field>
                            ))}
                        </section>
                    </Group>

                    <Group id="general" active={tab}>
                        <section className="flex flex-col gap-3">
                            <h2 className="text-muted text-xs font-medium uppercase tracking-wide">
                                People
                            </h2>
                            <form.Field name="vendorPattern">
                                {(field) => (
                                    <TextInput
                                        label="Vendor name pattern"
                                        description="A regular expression. A matching display name counts as a vendor. Leave empty to turn the rule off."
                                        placeholder="\(.+\)"
                                        value={field.state.value}
                                        onBlur={field.handleBlur}
                                        onChange={(e) =>
                                            field.handleChange(
                                                e.currentTarget.value,
                                            )
                                        }
                                    />
                                )}
                            </form.Field>
                        </section>
                        <section className="flex flex-col gap-3">
                            <h2 className="text-muted text-xs font-medium uppercase tracking-wide">
                                Schedule
                            </h2>
                            <div className="grid grid-cols-2 gap-3">
                                <form.Field name="workStartHour">
                                    {(field) => (
                                        <TextInput
                                            label="Work start (hour)"
                                            type="number"
                                            min={0}
                                            max={23}
                                            required
                                            value={field.state.value}
                                            onBlur={field.handleBlur}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    e.currentTarget.value,
                                                )
                                            }
                                        />
                                    )}
                                </form.Field>
                                <form.Field name="workEndHour">
                                    {(field) => (
                                        <TextInput
                                            label="Work end (hour)"
                                            type="number"
                                            min={0}
                                            max={23}
                                            required
                                            value={field.state.value}
                                            onBlur={field.handleBlur}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    e.currentTarget.value,
                                                )
                                            }
                                        />
                                    )}
                                </form.Field>
                            </div>
                            <form.Field name="workDays">
                                {(field) => (
                                    <Checkbox.Group
                                        label="Work days"
                                        value={field.state.value.map(String)}
                                        onChange={(values) =>
                                            field.handleChange(
                                                values
                                                    .map(Number)
                                                    .sort((a, b) => a - b),
                                            )
                                        }
                                    >
                                        <ControlGroup mt="xs" gap="sm">
                                            {DAYS.map((day, index) => (
                                                <Checkbox
                                                    key={day}
                                                    value={String(index)}
                                                    label={day}
                                                    onBlur={field.handleBlur}
                                                />
                                            ))}
                                        </ControlGroup>
                                    </Checkbox.Group>
                                )}
                            </form.Field>
                        </section>

                        <section className="flex flex-col gap-3">
                            <h2 className="text-muted text-xs font-medium uppercase tracking-wide">
                                Context bands
                            </h2>
                            <form.Field name="periods">
                                {(field) => (
                                    <Row
                                        label="Named periods"
                                        group
                                        hint="Shaded bands on the Load & capacity chart, e.g. Hackathon, Team week, PTO."
                                    >
                                        <div className="mt-1 flex flex-col gap-2">
                                            {field.state.value.map((p, i) => (
                                                <div
                                                    key={i}
                                                    className="flex items-center gap-2"
                                                >
                                                    <TextInput
                                                        className="w-full"
                                                        placeholder="Label"
                                                        value={p.label}
                                                        onChange={(e) => {
                                                            const next =
                                                                field.state.value.slice();
                                                            next[i] = {
                                                                ...next[i],
                                                                label: e.target
                                                                    .value,
                                                            };
                                                            field.handleChange(
                                                                next,
                                                            );
                                                        }}
                                                    />
                                                    <TextInput
                                                        type="date"
                                                        className="shrink-0"
                                                        value={p.start}
                                                        onChange={(e) => {
                                                            const next =
                                                                field.state.value.slice();
                                                            next[i] = {
                                                                ...next[i],
                                                                start: e.target
                                                                    .value,
                                                            };
                                                            field.handleChange(
                                                                next,
                                                            );
                                                        }}
                                                    />
                                                    <span className="text-muted text-xs">
                                                        →
                                                    </span>
                                                    <TextInput
                                                        type="date"
                                                        className="shrink-0"
                                                        value={p.end}
                                                        onChange={(e) => {
                                                            const next =
                                                                field.state.value.slice();
                                                            next[i] = {
                                                                ...next[i],
                                                                end: e.target
                                                                    .value,
                                                            };
                                                            field.handleChange(
                                                                next,
                                                            );
                                                        }}
                                                    />
                                                    <Button
                                                        variant="default"
                                                        type="button"
                                                        onClick={() =>
                                                            field.handleChange(
                                                                field.state.value.filter(
                                                                    (_, j) =>
                                                                        j !== i,
                                                                ),
                                                            )
                                                        }
                                                        className="shrink-0"
                                                        aria-label="Remove period"
                                                    >
                                                        ✕
                                                    </Button>
                                                </div>
                                            ))}
                                            <Button
                                                variant="default"
                                                type="button"
                                                onClick={() =>
                                                    field.handleChange([
                                                        ...field.state.value,
                                                        {
                                                            label: "",
                                                            start: "",
                                                            end: "",
                                                        },
                                                    ])
                                                }
                                                className="w-fit"
                                            >
                                                + Add period
                                            </Button>
                                        </div>
                                    </Row>
                                )}
                            </form.Field>
                        </section>
                    </Group>

                    <Group id="app" active={tab}>
                        <section className="flex flex-col gap-3">
                            <h2 className="text-muted text-xs font-medium uppercase tracking-wide">
                                Updates
                            </h2>
                            {version && (
                                <div className="text-muted flex items-center gap-3 text-xs">
                                    <span>Argus v{version}</span>
                                    <Button
                                        variant="default"
                                        type="button"
                                        disabled={
                                            checking || !cfg.checkForUpdates
                                        }
                                        title={
                                            cfg.checkForUpdates
                                                ? undefined
                                                : "Turn on update checks to use this"
                                        }
                                        onClick={() => void checkNow()}
                                    >
                                        {checking
                                            ? "Checking…"
                                            : "Check for updates"}
                                    </Button>
                                </div>
                            )}
                            <form.Field name="checkForUpdates">
                                {(field) => (
                                    <Row
                                        label="Check for new versions"
                                        hint="Once a day, Argus asks GitHub for the latest release and shows a notice in the bell. It sends no data about you."
                                    >
                                        <label className="mt-1 flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={field.state.value}
                                                onChange={(e) =>
                                                    field.handleChange(
                                                        e.target.checked,
                                                    )
                                                }
                                            />
                                            Enabled
                                        </label>
                                    </Row>
                                )}
                            </form.Field>
                        </section>

                        <section className="grid grid-cols-2 gap-3">
                            <h2 className="text-muted col-span-2 text-xs font-medium uppercase tracking-wide">
                                Discovery &amp; logs
                            </h2>
                            <form.Field name="recencyDays">
                                {(field) => (
                                    <Row
                                        label="Recency (days)"
                                        hint="Auto-add untracked PRs newer than this."
                                    >
                                        <TextInput
                                            type="number"
                                            min={1}

                                            value={field.state.value}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    Number(e.target.value),
                                                )
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                            <form.Field name="retentionDays">
                                {(field) => (
                                    <Row label="Log retention (days)">
                                        <TextInput
                                            type="number"
                                            min={1}

                                            value={field.state.value}
                                            onChange={(e) =>
                                                field.handleChange(
                                                    Number(e.target.value),
                                                )
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                        </section>

                        <section className="flex flex-col gap-3">
                            <h2 className="text-muted text-xs font-medium uppercase tracking-wide">
                                Your data
                            </h2>
                            <div className="text-muted text-xs">
                                Argus keeps PR titles, people names, votes, and
                                your review history on this computer. Delete all
                                of it here. Your settings stay. Argus reads your
                                open PRs from Azure DevOps again on the next
                                poll, but the history is gone for good.
                            </div>
                            <div className="flex items-center gap-2">
                                {confirmDelete ? (
                                    <>
                                        <Button
                                            variant="filled"
                                            color="red"
                                            type="button"
                                            disabled={deleting}
                                            onClick={() => void deleteAll()}
                                        >
                                            {deleting
                                                ? "Deleting…"
                                                : "Yes, delete everything"}
                                        </Button>
                                        <Button
                                            variant="default"
                                            type="button"
                                            disabled={deleting}
                                            onClick={() =>
                                                setConfirmDelete(false)
                                            }
                                        >
                                            Cancel
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        variant="light"
                                        color="red"
                                        type="button"
                                        onClick={() => setConfirmDelete(true)}
                                    >
                                        Delete all data
                                    </Button>
                                )}
                            </div>
                        </section>
                    </Group>
                </div>
            </div>

            <form.Subscribe
                selector={(s) => ({
                    isDirty: s.isDirty,
                    isSubmitting: s.isSubmitting,
                })}
            >
                {({ isDirty, isSubmitting }) =>
                    isDirty ? (
                        <div
                            className="fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 backdrop-blur"
                            style={{
                                background:
                                    "color-mix(in srgb, var(--color-surface) 92%, transparent)",
                                borderColor:
                                    "color-mix(in srgb, var(--mantine-color-orange-6) 45%, var(--color-line))",
                            }}
                        >
                            <div className="mx-auto flex max-w-3xl items-center gap-3">
                                <span className="text-muted text-sm">
                                    Unsaved changes
                                </span>
                                <div className="ml-auto flex items-center gap-2">
                                    <Button
                                        type="button"
                                        onClick={() => form.reset()}
                                        variant="default"
                                    >
                                        Reset
                                    </Button>
                                    <Button
                                        type="submit"
                                        loading={isSubmitting}
                                    >
                                        {isSubmitting
                                            ? "Saving…"
                                            : "Save settings"}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : null
                }
            </form.Subscribe>
        </form>
    );
}
