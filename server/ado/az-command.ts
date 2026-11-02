import { existsSync } from "node:fs";
import path from "node:path";

export type AzCommand = [file: string, args: string[]];

// Node cannot spawn `az.cmd` without a shell (CVE-2024-27980), and a shell would
// interpret metacharacters in the arguments. The Windows install lays out
// `<CLI2>\wbin\az.cmd` next to `<CLI2>\python.exe`, and `az.cmd` only starts that
// interpreter with `-IBm azure.cli`. Start it directly so execFile gets a plain
// argument array and no shell is involved.
export function resolveAzCommand(
    args: string[],
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    exists: (file: string) => boolean = existsSync,
): AzCommand {
    if (platform !== "win32") return ["az", args];
    const dirs = (env.PATH ?? env.Path ?? "").split(path.win32.delimiter);
    for (const entry of dirs) {
        const dir = entry.trim().replace(/^"(.*)"$/, "$1");
        if (!dir) continue;
        const shim = path.win32.join(dir, "az.cmd");
        if (!exists(shim)) continue;
        const python = path.win32.resolve(dir, "..", "python.exe");
        if (exists(python)) return [python, ["-IBm", "azure.cli", ...args]];
    }
    throw new Error(
        "Azure CLI not found. Install it from https://aka.ms/installazurecliwindows and restart Argus.",
    );
}
