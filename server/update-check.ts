export interface ReleaseInfo {
    version: string;
    url: string;
}

const LATEST_RELEASE_URL =
    "https://api.github.com/repos/WretchedDade/argus/releases/latest";

function parseVersion(value: string): number[] | null {
    const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return match
        ? [Number(match[1]), Number(match[2]), Number(match[3])]
        : null;
}

// True when `latest` is a higher MAJOR.MINOR.PATCH than `current`.
export function isNewerVersion(latest: string, current: string): boolean {
    const a = parseVersion(latest);
    const b = parseVersion(current);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
}

// Ask GitHub for the latest published release. Returns null on any failure.
export async function fetchLatestRelease(
    fetchFn: typeof fetch = fetch,
): Promise<ReleaseInfo | null> {
    try {
        const res = await fetchFn(LATEST_RELEASE_URL, {
            headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "argus-update-check",
            },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
            tag_name?: unknown;
            html_url?: unknown;
        };
        if (
            typeof body.tag_name !== "string" ||
            typeof body.html_url !== "string" ||
            !parseVersion(body.tag_name)
        )
            return null;
        return {
            version: body.tag_name.replace(/^v/, ""),
            url: body.html_url,
        };
    } catch {
        return null;
    }
}
