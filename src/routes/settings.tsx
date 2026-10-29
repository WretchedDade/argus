import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    configApi,
    configQuery,
    teamsQuery,
    type ArgusConfig,
    type Period,
} from "../lib/api";
import {
    AccountPanel,
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

function Settings() {
    const qc = useQueryClient();
    const router = useRouter();
    const cfg = useQuery(configQuery).data as ArgusConfig;
    const teamOptions = useQuery(teamsQuery).data ?? [];

    const form = useForm({
        defaultValues: {
            me: cfg.me ?? "",
            adoAuth: cfg.adoAuth ?? "az",
            avatarUrl: cfg.avatarUrl ?? "",
            project: cfg.project,
            orgUrl: cfg.orgUrl,
            orgSlug: cfg.orgSlug,
            teamPatterns: cfg.teamPatterns as string[],
            teamLabels: cfg.teamLabels as Record<string, string>,
            periods: (cfg.periods ?? []) as Period[],
            reviewSkillName: cfg.reviewSkillName ?? "pr-review",
            recencyDays: cfg.recencyDays,
            retentionDays: cfg.retentionDays,
            workStartHour: cfg.workStartHour,
            workEndHour: cfg.workEndHour,
            workDays: cfg.workDays as number[],
            checkForUpdates: cfg.checkForUpdates ?? true,
        },
        onSubmit: async ({ value }) => {
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
                reviewSkillName: value.reviewSkillName.trim() || "pr-review",
                recencyDays: Number(value.recencyDays),
                retentionDays: Number(value.retentionDays),
                workStartHour: Number(value.workStartHour),
                workEndHour: Number(value.workEndHour),
                workDays: value.workDays,
                checkForUpdates: value.checkForUpdates,
            });
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
            className="mx-auto flex max-w-xl flex-col gap-5 pb-24"
        >
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
                                        { v: "az", label: "Azure CLI" },
                                        {
                                            v: "broker",
                                            label: "Windows account",
                                        },
                                    ]}
                                />
                            </div>
                            <div className="text-muted mt-1 text-xs">
                                Azure CLI uses your az login. Windows account
                                uses the Windows account broker and needs an
                                Entra app registration (Windows only). Applies
                                without a restart.
                            </div>
                        </div>
                    )}
                </form.Field>
                <AccountPanel />
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
                                    field.handleChange(e.target.value)
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
                                    field.handleChange(e.target.value)
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
                                onChange={(v) => field.handleChange(v)}
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
                                onChange={(v) => field.handleChange(v)}
                            />
                        </Row>
                    )}
                </form.Field>
            </section>

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
                                    field.handleChange(e.target.value)
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
                                    field.handleChange(e.target.value)
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
                                    field.handleChange(e.target.value)
                                }
                            />
                        </Row>
                    )}
                </form.Field>
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
                                    field.handleChange(e.target.value)
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
                                    const on = field.state.value.includes(i);
                                    return (
                                        <button
                                            key={d}
                                            type="button"
                                            onClick={() =>
                                                field.handleChange(
                                                    on
                                                        ? field.state.value.filter(
                                                              (x) => x !== i,
                                                          )
                                                        : [
                                                              ...field.state
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
                    Updates
                </h2>
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
                                        field.handleChange(e.target.checked)
                                    }
                                />
                                Enabled
                            </label>
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
                                                    label: e.target.value,
                                                };
                                                field.handleChange(next);
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
                                                    start: e.target.value,
                                                };
                                                field.handleChange(next);
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
                                                    end: e.target.value,
                                                };
                                                field.handleChange(next);
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                field.handleChange(
                                                    field.state.value.filter(
                                                        (_, j) => j !== i,
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
                                            { label: "", start: "", end: "" },
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
                                    field.handleChange(Number(e.target.value))
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
                                    field.handleChange(Number(e.target.value))
                                }
                            />
                        </Row>
                    )}
                </form.Field>
            </section>

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
                            <div className="mx-auto flex max-w-xl items-center gap-3">
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
