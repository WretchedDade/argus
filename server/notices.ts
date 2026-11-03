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
        release.checksumUrl &&
        isNewerVersion(release.version, appVersion)
    ) {
        notices.push({
            id: `app-update:${release.version}`,
            kind: "app-update",
            title: `Argus ${release.version} is available`,
            detail: `You have ${appVersion}.\nArgus can download the new version, check it, and install it. Then reload extensions.`,
            href: release.url,
            actionLabel: "Update now",
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
