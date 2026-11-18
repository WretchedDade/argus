import assert from "node:assert/strict";
import type { ActivityEntry } from "./api.ts";
import { filterTraceEntries } from "./activity.ts";
import { describe, it } from "vitest";

describe("src/lib/activity", () => {
    const entries: ActivityEntry[] = [
        {
            id: 1,
            runId: 42,
            ts: "2026-01-02T09:00:00.000Z",
            level: "info",
            msg: "Preview poll started",
            data: null,
        },
        {
            id: 2,
            runId: 42,
            ts: "2026-01-02T09:00:01.000Z",
            level: "warn",
            msg: "Preview enrichment warning",
            data: { operation: "Preview.Metadata" },
        },
        {
            id: 3,
            runId: 42,
            ts: "2026-01-02T09:00:02.000Z",
            level: "ERROR",
            msg: "Preview poll failed",
            data: { status: 503 },
        },
        {
            id: 4,
            runId: 42,
            ts: "2026-01-02T09:00:03.000Z",
            level: "fatal",
            msg: "Preview fatal error",
            data: null,
        },
    ];
    it("filters warning and error levels", async () => {
        assert.deepEqual(
            filterTraceEntries(entries, "issues", "").map((entry) => entry.id),
            [2, 3, 4],
        );
        assert.deepEqual(
            filterTraceEntries(entries, "errors", "").map((entry) => entry.id),
            [3, 4],
        );
    });
    it("searches messages and structured data", async () => {
        assert.deepEqual(
            filterTraceEntries(entries, "all", "  PREVIEW.METADATA ").map(
                (entry) => entry.id,
            ),
            [2],
        );
        assert.deepEqual(
            filterTraceEntries(entries, "issues", "503").map(
                (entry) => entry.id,
            ),
            [3],
        );
        assert.deepEqual(
            filterTraceEntries(entries, "errors", "enrichment"),
            [],
        );
    });
    it("preserves all entries when no filter applies", async () => {
        assert.deepEqual(filterTraceEntries(entries, "all", ""), entries);
    });
});
