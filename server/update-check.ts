export interface ReleaseInfo {
    version: string;
    url: string;
    zipUrl: string; // download URL of the Windows ZIP, taken from the release assets
    checksumUrl: string; // download URL of the ZIP's SHA-256 file
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
            assets?: {
                name?: unknown;
                state?: unknown;
                browser_download_url?: unknown;
            }[];
        };
        if (
            typeof body.tag_name !== "string" ||
            typeof body.html_url !== "string" ||
            !parseVersion(body.tag_name)
        )
            return null;
        const version = body.tag_name.replace(/^v/, "");
        const zip = (Array.isArray(body.assets) ? body.assets : []).find(
            (a) =>
                a?.name === `argus-v${version}-windows.zip` &&
                a.state === "uploaded",
        );
        const checksum = (Array.isArray(body.assets) ? body.assets : []).find(
            (a) =>
                a?.name === `argus-v${version}-windows.zip.sha256` &&
                a.state === "uploaded",
        );
        if (
            typeof zip?.browser_download_url !== "string" ||
            typeof checksum?.browser_download_url !== "string"
        )
            return null;
        return {
            version,
            url: body.html_url,
            zipUrl: zip.browser_download_url,
            checksumUrl: checksum.browser_download_url,
        };
    } catch {
        return null;
    }
}
