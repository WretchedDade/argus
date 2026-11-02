import { isNewerVersion, type ReleaseInfo } from "./update-check.ts";

// One row in the notification bell, besides the review sessions ready to archive.
export interface Notice {
    id: string; // dismissal key; changes when there is something new to say
    kind: "app-update" | "skill-update" | "storage";
    title: string;
    detail: string;
    href?: string;
    actionLabel?: string; // button that sends `prompt` to the chat
    prompt?: string; // server only; never sent to the browser
}

export interface NoticeInputs {
    appVersion: string;
    release: ReleaseInfo | null;
    checkForUpdates: boolean;
    installDir: string; // the installed extension folder
    skill: {
        bundledHash: string;
        bundledPath: string;
        installedPath: string;
    } | null;
    // Set while the database is an old OneDrive file that Argus kept using.
    legacyDb?: { path: string; localPath: string; choiceFile: string } | null;
}

const skillSteps = (bundled: string, installed: string): string =>
    `Merge the new bundled pr-review skill into the installed one without losing the user's edits. Bundled copy: ${bundled}. Installed copy: ${installed}. Show the user a short summary of what you merged.`;

export function buildNotices(inputs: NoticeInputs): Notice[] {
    const notices: Notice[] = [];
    const { release, appVersion } = inputs;
    if (
        inputs.checkForUpdates &&
        release?.zipUrl &&
        isNewerVersion(release.version, appVersion)
    ) {
        const zip = release.zipUrl;
        notices.push({
            id: `app-update:${release.version}`,
            kind: "app-update",
            title: `Argus ${release.version} is available`,
            detail: `You have ${appVersion}.\nCopilot can download the new version and update your install.`,
            href: release.url,
            actionLabel: "Update with Copilot",
            prompt: [
                `Update my Argus installation from ${appVersion} to ${release.version}.`,
                `1. Download ${zip} to a temporary folder and extract it.`,
                `2. Copy the extracted \`extension\` folder over the installed folder at ${inputs.installDir}. Do not delete the installed folder first, and keep \`argus.config.json\` and any database file inside it.`,
                `3. If I edited my installed pr-review skill, ${skillSteps("the `skills\\pr-review` folder in the extracted `extension` folder", "my installed pr-review skill")} Skip this step if I never edited it, because Argus updates an unedited skill on its own.`,
                `4. Tell me to reload extensions. After I reload, if you merged the skill, call the Argus canvas action \`acknowledgeSkillMerge\`.`,
                `Release notes: ${release.url}`,
            ].join("\n"),
        });
    }
    if (inputs.skill) {
        notices.push({
            id: `skill-update:${inputs.skill.bundledHash}`,
            kind: "skill-update",
            title: "A newer baseline pr-review skill is available",
            detail: `Your edited copy was left as it is.\nCopilot can merge the new version into it.`,
            actionLabel: "Merge with Copilot",
            prompt: [
                skillSteps(
                    inputs.skill.bundledPath,
                    inputs.skill.installedPath,
                ),
                "When done, call the Argus canvas action `acknowledgeSkillMerge` so this notice clears.",
            ].join("\n"),
        });
    }
    if (inputs.legacyDb) {
        const { path: from, localPath, choiceFile } = inputs.legacyDb;
        notices.push({
            id: "storage-legacy",
            kind: "storage",
            title: "Your database is still on OneDrive",
            detail: `Argus now stores history in ${localPath} by default. Your existing file stays at ${from}, and OneDrive syncs it.\nMove it to keep private PR data off OneDrive, or keep it there as a backup. This notice goes away after you choose and reload extensions.`,
            actionLabel: "Choose with Copilot",
            prompt: [
                `My Argus database is still at ${from}, which OneDrive syncs. Ask me which I want, then do exactly that. Argus copies the database when extensions reload, so do not copy any database files yourself.`,
                `A. Move it to local storage. Write \`{ "location": "local" }\` to ${choiceFile}.`,
                `B. Keep it on OneDrive as a backup. Write \`{ "location": "onedrive" }\` to ${choiceFile}.`,
                `After the write, tell me to close every other Copilot session that runs Argus, then reload extensions. For A, the old file at ${from} stays as a backup until I delete it.`,
            ].join("\n"),
        });
    }
    return notices;
}
