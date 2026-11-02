import assert from "node:assert/strict";
import { resolveAzCommand } from "./az-command.ts";

const args = ["repos", "pr", "list", "--project", "x & calc.exe"];
const present = new Set([
    "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd",
    "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\python.exe",
]);
const exists = (file: string) => present.has(file);
const env = {
    PATH: "C:\\Windows;C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin",
};

// Windows: the bundled interpreter runs directly, so no shell sees the arguments.
const [file, argv] = resolveAzCommand(args, "win32", env, exists);
assert.equal(
    file,
    "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\python.exe",
);
assert.deepEqual(argv, ["-IBm", "azure.cli", ...args]);
assert.ok(!/cmd(\.exe)?$/i.test(file));
assert.ok(!argv.includes("/c"));

// Windows without the CLI gives a clear error.
assert.throws(
    () => resolveAzCommand(args, "win32", { PATH: "C:\\Windows" }, exists),
    /Azure CLI not found/,
);
assert.throws(
    () => resolveAzCommand(args, "win32", env, (f) => f.endsWith("az.cmd")),
    /Azure CLI not found/,
);

// Other platforms run `az` directly.
assert.deepEqual(resolveAzCommand(args, "linux", {}, exists), ["az", args]);

console.log("az-command self-check OK");
