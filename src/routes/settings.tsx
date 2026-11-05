import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
                                    <select
                                        aria-label={`Scope for ${r.repo}`}
                                        className="border-line bg-canvas rounded-md border px-2 py-1 text-xs"
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
                                    </select>
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
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <label className="block">
            <div className="text-fg text-sm font-medium">{label}</div>
            {children}
            {hint && <div className="text-muted mt-1 text-xs">{hint}</div>}
        </label>
    );
}

const inputCls =
    "border-line bg-canvas mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm";

const trimModel = (m: { model: string; reasoningEffort: string }) => ({
    model: m.model.trim(),
    reasoningEffort: m.reasoningEffort.trim(),
});

const REVIEW_MODES = [
    { id: "quick", label: "Quick review" },
    { id: "full", label: "Full review" },
    { id: "automatic", label: "Automatic review" },
] as const;

const GROUPS = [
    { id: "general", label: "General" },
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
            workStartHour: cfg.workStartHour,
            workEndHour: cfg.workEndHour,
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
            <div className="flex gap-8">
                <nav className="flex w-36 shrink-0 flex-col gap-1">
                    {GROUPS.map((g) => (
                        <button
                            key={g.id}
                            type="button"
                            aria-current={tab === g.id ? "true" : undefined}
                            onClick={() => setTab(g.id)}
                            className={`rounded-md px-3 py-1.5 text-left text-sm ${
                                tab === g.id
                                    ? "text-fg bg-surface font-medium"
                                    : "text-muted hover:text-fg"
                            }`}
                        >
                            {g.label}
                        </button>
                    ))}
                </nav>
                <div className="min-w-0 flex-1">
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
                                        <input
                                            className={inputCls}
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
                                        <input
                                            className={inputCls}
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
                                        <input
                                            className={inputCls}
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
                                        <input
                                            className={inputCls}
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
                                        <input
                                            className={inputCls}
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
                                    <Row
                                        label="Team reviewer patterns"
                                        hint="Pick teams seen on your PRs, or type a custom *glob*."
                                    >
                                        <TeamMultiSelect
                                            value={field.state.value}
                                            options={teamOptions}
                                            onChange={(v) =>
                                                field.handleChange(v)
                                            }
                                        />
                                    </Row>
                                )}
                            </form.Field>
                            <form.Field name="teamLabels">
                                {(field) => (
                                    <Row
                                        label="Team labels"
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
                                        <input
                                            className={inputCls}
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
                                                <input
                                                    className={inputCls}
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
                                                <input
                                                    className={inputCls}
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
                                    <Row
                                        label="Vendor name pattern"
                                        hint="A regular expression. A display name that matches counts as a vendor. Default: \(.+\) (a name with parentheses). Leave empty to turn the rule off."
                                    >
                                        <input
                                            className={inputCls}
                                            placeholder="\(.+\)"
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
                                Schedule
                            </h2>
                            <div className="grid grid-cols-2 gap-3">
                                <form.Field name="workStartHour">
                                    {(field) => (
                                        <Row label="Work start (hour)">
                                            <input
                                                type="number"
                                                min={0}
                                                max={23}
                                                className={inputCls}
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
                                <form.Field name="workEndHour">
                                    {(field) => (
                                        <Row label="Work end (hour)">
                                            <input
                                                type="number"
                                                min={0}
                                                max={23}
                                                className={inputCls}
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
                            </div>
                            <form.Field name="workDays">
                                {(field) => (
                                    <Row label="Work days">
                                        <div className="mt-1 flex gap-1">
                                            {DAYS.map((d, i) => {
                                                const on =
                                                    field.state.value.includes(
                                                        i,
                                                    );
                                                return (
                                                    <button
                                                        key={d}
                                                        type="button"
                                                        onClick={() =>
                                                            field.handleChange(
                                                                on
                                                                    ? field.state.value.filter(
                                                                          (x) =>
                                                                              x !==
                                                                              i,
                                                                      )
                                                                    : [
                                                                          ...field
                                                                              .state
                                                                              .value,
                                                                          i,
                                                                      ].sort(),
                                                            )
                                                        }
                                                        className="rounded-md border px-2 py-1 text-xs"
                                                        style={{
                                                            borderColor: on
                                                                ? "var(--peacock-teal)"
                                                                : "var(--color-line)",
                                                            background: on
                                                                ? "color-mix(in srgb, var(--peacock-teal) 16%, transparent)"
                                                                : "transparent",
                                                        }}
                                                    >
                                                        {d}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </Row>
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
                                        hint="Shaded bands on the Load & capacity chart, e.g. Hackathon, Team week, PTO."
                                    >
                                        <div className="mt-1 flex flex-col gap-2">
                                            {field.state.value.map((p, i) => (
                                                <div
                                                    key={i}
                                                    className="flex items-center gap-2"
                                                >
                                                    <input
                                                        className="border-line bg-canvas w-full rounded-md border px-2.5 py-1.5 text-sm"
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
                                                    <input
                                                        type="date"
                                                        className="border-line bg-canvas shrink-0 rounded-md border px-2 py-1.5 text-sm"
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
                                                    <input
                                                        type="date"
                                                        className="border-line bg-canvas shrink-0 rounded-md border px-2 py-1.5 text-sm"
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
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            field.handleChange(
                                                                field.state.value.filter(
                                                                    (_, j) =>
                                                                        j !== i,
                                                                ),
                                                            )
                                                        }
                                                        className="text-muted hover:text-fg shrink-0 rounded-md border border-line px-2 py-1.5 text-xs"
                                                        aria-label="Remove period"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                            <button
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
                                                className="text-muted hover:text-fg w-fit rounded-md border border-line px-2.5 py-1 text-xs"
                                            >
                                                + Add period
                                            </button>
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
                                    <button
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
                                        className="border-line text-muted hover:text-fg rounded-md border px-2 py-0.5 disabled:opacity-60"
                                    >
                                        {checking
                                            ? "Checking…"
                                            : "Check for updates"}
                                    </button>
                                </div>
                            )}
                            <form.Field name="checkForUpdates">
                                {(field) => (
                                    <Row
                                        label="Check for new versions"
                                        hint="Once a day, Argus asks GitHub for the latest release and shows a notice in the bell. It sends no data about you."
                                    >
                                        <label className="mt-1 flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
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
                                        <input
                                            type="number"
                                            min={1}
                                            className={inputCls}
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
                                        <input
                                            type="number"
                                            min={1}
                                            className={inputCls}
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
                                        <button
                                            type="button"
                                            disabled={deleting}
                                            onClick={() => void deleteAll()}
                                            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                                        >
                                            {deleting
                                                ? "Deleting…"
                                                : "Yes, delete everything"}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={deleting}
                                            onClick={() =>
                                                setConfirmDelete(false)
                                            }
                                            className="border-line text-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm"
                                        >
                                            Cancel
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDelete(true)}
                                        className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/20"
                                    >
                                        Delete all data
                                    </button>
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
                                    "color-mix(in srgb, var(--peacock-gold) 45%, var(--color-line))",
                            }}
                        >
                            <div className="mx-auto flex max-w-3xl items-center gap-3">
                                <span className="text-muted text-sm">
                                    Unsaved changes
                                </span>
                                <div className="ml-auto flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => form.reset()}
                                        className="border-line text-muted hover:text-fg rounded-md border px-3 py-1.5 text-sm"
                                    >
                                        Reset
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                                        style={{
                                            background: "var(--peacock-teal)",
                                        }}
                                    >
                                        {isSubmitting
                                            ? "Saving…"
                                            : "Save settings"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : null
                }
            </form.Subscribe>
        </form>
    );
}
