import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const packageSchema = z.object({
    version: z.string().min(1),
    argusDistribution: z.enum(["zip", "plugin"]).optional(),
});

export function readInstallation(extensionDir: string) {
    for (const dir of [extensionDir, path.dirname(extensionDir)]) {
        const file = path.join(dir, "package.json");
        if (!existsSync(file)) continue;
        const pkg = packageSchema.parse(JSON.parse(readFileSync(file, "utf8")));
        return {
            version: pkg.version,
            plugin: pkg.argusDistribution === "plugin",
        };
    }
    throw new Error("Argus package.json was not found.");
}
