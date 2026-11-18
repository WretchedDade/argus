import { Button, Fieldset, Radio, Stack, TextInput } from "@mantine/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    configApi,
    configQuery,
    healthQuery,
    type ArgusConfig,
} from "../lib/api";
import { BrandMark } from "./BrandMark";
import { SegToggle } from "./SegToggle";
import { pushToast } from "../lib/toast";
import { setupFormReady } from "../lib/errors";
import { LoadErrorPage, PendingPage } from "./ErrorBanner";

// First-run gate. The shipped config defaults are one team's, so ownership
// classification is wrong until a new user sets their own org/project/team
// reviewer groups. This screen collects the minimum needed, then flips
// setup_complete so the board takes over. Reachable again only by clearing the
// store; everything here is also editable later under Settings.
export function SetupGate() {
    const config = useQuery(configQuery);
    if (setupFormReady(config)) return <SetupForm cfg={config.data!} />;
    return (
        <div className="app-bg text-fg flex min-h-screen items-center justify-center p-6">
            {config.isError ? (
                <LoadErrorPage
                    what="your config"
                    error={config.error}
                    onRetry={() => void config.refetch()}
                    showActivityLink={false}
                />
            ) : (
                <PendingPage />
            )}
        </div>
    );
}

function SetupForm({ cfg }: { cfg: ArgusConfig }) {
    const qc = useQueryClient();
    const detected = useQuery(healthQuery).data?.poller.me ?? null;

    const [me, setMe] = useState(cfg?.me ?? "");
    const [adoAuth, setAdoAuth] = useState<ArgusConfig["adoAuth"]>(
        cfg?.adoAuth ?? "az",
    );
    const [orgUrl, setOrgUrl] = useState(cfg?.orgUrl ?? "");
    const [orgSlug, setOrgSlug] = useState(cfg?.orgSlug ?? "");
    const [project, setProject] = useState(cfg?.project ?? "");
    const [teams, setTeams] = useState((cfg?.teamPatterns ?? []).join(", "));
    const [installSkill, setInstallSkill] = useState(true);
    const [skillName, setSkillName] = useState(
        cfg?.reviewSkillName ?? "pr-review",
    );
    const [saving, setSaving] = useState(false);
    const storage = useQuery(healthQuery).data?.storage ?? null;
    const [dbLocation, setDbLocation] = useState<"local" | "onedrive">("local");
    const showStorage = !!storage?.choosable;

    const patterns = teams
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const canSave =
        orgUrl.trim() && orgSlug.trim() && project.trim() && !saving;

    const submit = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            const { skill, storage: moved } = await configApi.setup({
                adoAuth,
                me: me.trim() || null,
                orgUrl: orgUrl.trim(),
                orgSlug: orgSlug.trim(),
                project: project.trim(),
                teamPatterns: patterns,
                reviewSkillName: installSkill
                    ? "pr-review"
                    : skillName.trim() || "pr-review",
                installPrReviewSkill: installSkill,
                ...(showStorage ? { dbLocation } : {}),
            });
            await Promise.all([
                qc.invalidateQueries({ queryKey: ["health"] }),
                qc.invalidateQueries({ queryKey: ["config"] }),
                qc.invalidateQueries({ queryKey: ["prs"] }),
            ]);
            if (moved?.restartRequired) {
                pushToast("Reload extensions to use the new storage location");
            }
            if (installSkill) {
                pushToast(
                    skill.installed
                        ? "Setup complete — pr-review skill installed"
                        : `Setup complete — ${skill.reason ?? "skill not installed"}`,
                    skill.installed ? undefined : "error",
                );
            } else {
                pushToast("Setup complete — watching your PRs");
            }
        } catch {
            pushToast("Couldn't save setup", "error");
            setSaving(false);
        }
    };

    return (
        <div className="app-bg text-fg flex min-h-screen items-center justify-center p-6">
            <div className="border-line bg-canvas w-full max-w-lg rounded-2xl border p-6 shadow-lg">
                <div className="mb-1 flex items-center gap-2.5">
                    <span className="app-header flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                        <BrandMark size={26} />
                    </span>
                    <span className="text-lg font-semibold tracking-tight">
                        Welcome to Argus
                    </span>
                </div>
                <p className="text-muted mb-5 text-sm">
                    Argus watches the Azure DevOps pull requests that need your
                    review. Point it at your org, and optionally the reviewer
                    groups you belong to, and it will track what is on your
                    plate. You can change any of this later in Settings.
                </p>

                <div className="flex flex-col gap-4">
                    <div>
                        <div className="text-fg mb-1 text-sm font-medium">
                            Sign-in method
                        </div>
                        <SegToggle
                            aria-label="Sign-in method"
                            value={adoAuth}
                            onChange={setAdoAuth}
                            options={[
                                { v: "az", label: "Azure CLI" },
                                { v: "broker", label: "Windows account" },
                            ]}
                        />
                        <div className="text-muted mt-1 text-xs">
                            {adoAuth === "az"
                                ? "Uses your az login. Run az login in a terminal if you have not."
                                : "Windows only. Needs an Entra app registration; the next screen asks for its client and tenant IDs."}
                        </div>
                    </div>

                    {showStorage && (
                        <div>
                            <div className="text-fg mb-1 text-sm font-medium">
                                Where to keep your history
                            </div>
                            <SegToggle
                                aria-label="History storage location"
                                value={dbLocation}
                                onChange={setDbLocation}
                                options={[
                                    { v: "local", label: "This device" },
                                    ...(storage?.oneDriveAvailable
                                        ? [
                                              {
                                                  v: "onedrive" as const,
                                                  label: "OneDrive",
                                              },
                                          ]
                                        : []),
                                ]}
                            />
                            <div className="text-muted mt-1 text-xs">
                                {dbLocation === "local"
                                    ? "Private by default. PR titles, descriptions, and review history stay on this device. If you reset the device, the history is lost."
                                    : "OneDrive syncs the database, so a device reset does not lose your history. PR titles, descriptions, and review history sync to your OneDrive. Do not share one OneDrive database between devices that run Argus at the same time."}
                            </div>
                        </div>
                    )}

                    <TextInput
                        label="Identity"
                        description={
                            detected
                                ? `Signed in as ${detected} account. Leave blank to use it.`
                                : "Detected from your signed-in account. Leave blank to auto-detect, or set an override email."
                        }
                        inputWrapperOrder={[
                            "label",
                            "input",
                            "description",
                            "error",
                        ]}
                        placeholder={
                            detected
                                ? `auto: ${detected}`
                                : "auto from signed-in account"
                        }
                        value={me}
                        onChange={(e) => setMe(e.target.value)}
                    />

                    <div className="grid grid-cols-2 gap-3">
                        <TextInput
                            label="Org URL"
                            placeholder="https://dev.azure.com/your-org"
                            value={orgUrl}
                            onChange={(e) => setOrgUrl(e.target.value)}
                        />
                        <TextInput
                            label="Org slug"
                            placeholder="your-org"
                            value={orgSlug}
                            onChange={(e) => setOrgSlug(e.target.value)}
                        />
                    </div>

                    <TextInput
                        label="Project"
                        placeholder="YourProject"
                        value={project}
                        onChange={(e) => setProject(e.target.value)}
                    />
                    <TextInput
                        label="Your reviewer groups (optional)"
                        placeholder="*Content Lifecycle Engg*, *ASN UI stewards*"
                        value={teams}
                        onChange={(e) => setTeams(e.target.value)}
                        inputWrapperOrder={[
                            "label",
                            "input",
                            "description",
                            "error",
                        ]}
                        description={
                            <>
                                Comma-separated globs matched against the ADO
                                team reviewer names you belong to
                                (case-insensitive, <code>*</code> = wildcard).
                                For example, if you are on the group "MCAPS
                                E&amp;O WWL LPT - Content Lifecycle Engg", enter{" "}
                                <code>*Content Lifecycle Engg*</code>. A PR
                                counts as yours when one of these groups is a
                                reviewer. Leave this blank to track only PRs
                                where you are a direct reviewer or the author.
                                You can add groups in Settings once PRs load.
                            </>
                        }
                    />

                    <Fieldset legend="PR review skill" p="sm">
                        <div className="text-muted text-xs">
                            The board's Review buttons spawn a session that runs
                            a <code>pr-review</code> skill. Install the bundled
                            baseline, or bring your own.
                        </div>
                        <Radio.Group
                            name="review-skill"
                            aria-label="PR review skill"
                            value={installSkill ? "baseline" : "custom"}
                            onChange={(value) =>
                                setInstallSkill(value === "baseline")
                            }
                        >
                            <Stack gap="sm" mt="sm">
                                <Radio
                                    value="baseline"
                                    label="Install the baseline skill"
                                    description="Copies a neutral pr-review skill into your skills directory. Skipped if you already have one."
                                />
                                <Radio
                                    value="custom"
                                    label="I'll use my own"
                                    description="Leaves your skills directory untouched."
                                />
                            </Stack>
                        </Radio.Group>
                        {!installSkill && (
                            <TextInput
                                mt="sm"
                                label="Skill name"
                                description="The name from your skill's frontmatter. The Review buttons tell the agent to run this skill."
                                inputWrapperOrder={[
                                    "label",
                                    "input",
                                    "description",
                                    "error",
                                ]}
                                placeholder="pr-review"
                                value={skillName}
                                onChange={(e) => setSkillName(e.target.value)}
                            />
                        )}
                    </Fieldset>
                </div>

                <Button
                    variant="filled"
                    type="button"
                    disabled={!canSave}
                    loading={saving}
                    onClick={() => void submit()}
                    className="mt-6 w-full"
                >
                    Start watching
                </Button>
            </div>
        </div>
    );
}
