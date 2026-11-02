// Read-only smoke test of an acquired/extracted ZIP, including native loading but
// no account discovery, token acquisition, broker UI, or extension startup.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { verifyReleaseEvidence } from "./release-evidence.ts";

const args = process.argv.slice(2);
if (args.length !== 1)
    throw new Error("Usage: node scripts/verify-release.ts RELEASE_DIRECTORY");
const stage = path.resolve(args[0]);
verifyReleaseEvidence(stage);
const ext = path.join(stage, "extension");
const env = { ...process.env };
delete env.NODE_PATH;
execFileSync(process.execPath, ["--check", "extension.mjs"], {
    cwd: ext,
    env,
    stdio: "inherit",
});
execFileSync(
    process.execPath,
    [
        "--input-type=module",
        "-e",
        `
await import('@azure/identity');
await import('@azure/identity-broker');
if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Release verification supports Windows x64 only');
const { msalNodeRuntime } = await import('@azure/msal-node-runtime');
if (msalNodeRuntime.StartupError)
    throw new Error('Native MSAL runtime did not load');
console.log('Acquired runtime imports and native MSAL loading OK (no sign-in attempted)');
`,
    ],
    { cwd: ext, env, stdio: "inherit" },
);
console.log("Release evidence and entry-point syntax OK");
