import { isNewerVersion, type ReleaseInfo } from "./update-check.ts";

// One row in the notification bell, besides the review sessions ready to archive.
export interface Notice {
    id: string; // dismissal key; changes when there is something new to say
    kind: "app-update" | "skill-update";
    title: string;
    detail: string;
    href?: string;
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
}

export function buildNotices(inputs: NoticeInputs): Notice[] {
    const notices: Notice[] = [];
    const { release, appVersion } = inputs;
    if (
        inputs.checkForUpdates &&
        release &&
        isNewerVersion(release.version, appVersion)
    ) {
        notices.push({
            id: `app-update:${release.version}`,
            kind: "app-update",
            title: `Argus ${release.version} is available`,
            detail: `You have ${appVersion}.\nDownload the new ZIP from the release page, then follow the upgrade steps in INSTALL.md.`,
            href: release.url,
        });
    }
    if (inputs.skill) {
        notices.push({
            id: `skill-update:${inputs.skill.bundledHash}`,
            kind: "skill-update",
            title: "A newer baseline pr-review skill is available",
            detail: `Your edited copy was left as it is.\nCompare ${inputs.skill.bundledPath} with ${inputs.skill.installedPath}, then merge the changes you want.`,
        });
    }
    return notices;
}
