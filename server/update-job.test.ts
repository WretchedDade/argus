import assert from "node:assert/strict";
import { UpdateJob } from "./update-job.ts";

const tick = () => new Promise((r) => setImmediate(r));

// A second start is refused while the first one runs.
const job = new UpdateJob();
assert.equal(job.status().phase, "idle");
let finish!: () => void;
const phases: string[] = [];
assert.equal(
    job.start(async (setPhase) => {
        setPhase("installing");
        phases.push(job.status().phase);
        await new Promise<void>((r) => (finish = r));
    }),
    true,
);
assert.equal(
    job.start(async () => {}),
    false,
);
assert.deepEqual(phases, ["installing"]);
finish();
await tick();
assert.deepEqual(job.status(), { phase: "done", error: null });

// A failure keeps the message, and a new start is allowed afterwards.
assert.equal(
    job.start(async () => {
        throw new Error("boom");
    }),
    true,
);
await tick();
assert.deepEqual(job.status(), { phase: "error", error: "boom" });
assert.equal(
    job.start(async () => {}),
    true,
);
await tick();
assert.equal(job.status().phase, "done");
