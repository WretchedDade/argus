import assert from "node:assert/strict";
import { defaultConfig } from "../config.ts";
import { ArgusStore } from "../db.ts";
import { AdoError } from "./client.ts";
import { getPollerStatus, reconcileOnce } from "./poller.ts";
import { describe, it, vi } from "vitest";

describe("server/ado/poller-status", () => {
    it("a new poll clears the previous error without clearing failure history", async (t) => {
        const store = new ArgusStore(":memory:");
        t.onTestFinished(() => store.close());
        const ctx = { store, getConfig: defaultConfig };
        const recordActivity = store.recordActivity.bind(store);
        const errorsAtStart: (string | null)[] = [];
        let message = "Synthetic first failure";
        vi.spyOn(store, "recordActivity").mockImplementation(
            (...args: Parameters<ArgusStore["recordActivity"]>) => {
                if (args[1] === "reconcile started") {
                    errorsAtStart.push(getPollerStatus().lastError);
                    throw new AdoError(message);
                }
                return recordActivity(...args);
            },
        );

        assert.equal(await reconcileOnce(ctx), null);
        assert.equal(getPollerStatus().lastError, message);

        const lease = vi
            .spyOn(store, "acquirePollLease")
            .mockImplementation(() => false);
        assert.equal(await reconcileOnce(ctx), "skipped");
        assert.equal(getPollerStatus().lastError, message);
        assert.equal(errorsAtStart.length, 1);
        lease.mockRestore();

        message = "Synthetic retry failure";
        assert.equal(await reconcileOnce(ctx), null);
        assert.deepEqual(errorsAtStart, [null, null]);
        assert.equal(getPollerStatus().lastError, message);
        assert.equal(getPollerStatus().currentRunId, null);
        assert.deepEqual(
            store.listPollRuns().map((run) => ({
                ok: run.ok,
                error: run.error,
            })),
            [
                { ok: false, error: "Synthetic retry failure" },
                { ok: false, error: "Synthetic first failure" },
            ],
        );
    });
});
