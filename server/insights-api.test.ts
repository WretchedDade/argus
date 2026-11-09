import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock } from "node:test";
import { hc } from "hono/client";
import {
    InsightsResponseSchema,
    LoadDetailResponseSchema,
    WeeklyReviewFactsResponseSchema,
} from "#shared/schemas/insights";
import { handleApi, type ApiContext } from "./api.ts";
import { isHonoRoute, type AppType } from "./app.ts";
import { defaultConfig } from "./config.ts";
import { ArgusStore } from "./db.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-insights-api-test-"));
const store = new ArgusStore(path.join(dir, "argus.db"));
const config = {
    ...defaultConfig(),
    recencyDays: 17,
    workEndHour: 16,
    workDays: [1, 3, 5],
};
const context = { store, getConfig: () => config } as ApiContext;
const server = createServer((req, res) => {
    void handleApi(req, res, context).catch(() => {
        res.writeHead(500).end();
    });
});

try {
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const client = hc<AppType>(base).api;
    const get = (route: string, init?: RequestInit) =>
        fetch(`${base}${route}`, init);
    const work = { endHour: config.workEndHour, days: config.workDays };
    const insights = mock.method(store, "computeInsights");
    const day = mock.method(store, "loadDayDetail");
    const week = mock.method(store, "loadWeekDetail");

    const summary = await get("/api/insights");
    assert.equal(summary.status, 200);
    InsightsResponseSchema.parse(await summary.json());
    assert.deepEqual(insights.mock.calls[0].arguments, [17, work]);

    for (const granularity of ["day", "week"] as const) {
        const response = await get(
            `/api/load/detail?key=2026-10-19&granularity=${granularity}`,
        );
        assert.equal(response.status, 200);
        const { detail } = LoadDetailResponseSchema.parse(
            await response.json(),
        );
        assert.deepEqual(
            detail,
            granularity === "day"
                ? store.loadDayDetail("2026-10-19", 17, work)
                : store.loadWeekDetail("2026-10-19", 17, work),
        );
        assert.deepEqual(
            (granularity === "day" ? day : week).mock.calls[0].arguments,
            ["2026-10-19", 17, work],
        );
    }

    const reviews = await get("/api/reviews/week?key=2026-10-19");
    assert.equal(reviews.status, 200);
    assert.deepEqual(
        WeeklyReviewFactsResponseSchema.parse(await reviews.json()),
        { facts: store.weeklyReviewFacts("2026-10-19") },
    );

    const typedLoad = await client.load.detail.$get({
        query: { key: "2026-10-19", granularity: "week" },
    });
    assert.equal(typedLoad.status, 200);
    LoadDetailResponseSchema.parse(await typedLoad.json());
    const typedReviews = await client.reviews.week.$get({
        query: { key: "2026-10-19" },
    });
    assert.equal(typedReviews.status, 200);
    WeeklyReviewFactsResponseSchema.parse(await typedReviews.json());
    const typedInsights = await client.insights.$get();
    assert.equal(typedInsights.status, 200);
    InsightsResponseSchema.parse(await typedInsights.json());

    for (const route of [
        "/api/load/detail?key=2026-10-19&key=bad&granularity=day&granularity=bad",
        "/api/reviews/week?key=2026-10-19&key=bad",
        "/api/load/detail?key=2026-02-30&granularity=day",
    ]) {
        const response = await get(route);
        assert.equal(response.status, 200, route);
        await response.arrayBuffer();
    }

    const invalidQueries = [
        ["/api/load/detail", "key (YYYY-MM-DD) required"],
        [
            "/api/load/detail?key=2026-1-01&granularity=day",
            "key (YYYY-MM-DD) required",
        ],
        [
            "/api/load/detail?key=2026-10-19",
            "granularity (day or week) required",
        ],
        [
            "/api/load/detail?key=2026-10-19&granularity=month",
            "granularity (day or week) required",
        ],
        ...["", "2026-10-20", "2026-02-30", "2026-1-01"].map((key) => [
            `/api/reviews/week?key=${key}`,
            "key must be a Monday in YYYY-MM-DD format",
        ]),
    ];
    for (const [route, error] of invalidQueries) {
        const response = await get(route);
        assert.equal(response.status, 400, route);
        assert.deepEqual(await response.json(), { error }, route);
    }

    for (const route of [
        "/api/insights",
        "/api/load/detail?key=2026-10-19&granularity=day",
        "/api/reviews/week?key=2026-10-19",
    ]) {
        const untrusted = await get(route, {
            headers: { Origin: "http://evil.example" },
        });
        assert.equal(untrusted.status, 403);
        assert.deepEqual(await untrusted.json(), {
            error: "Untrusted origin.",
        });
        // The legacy read routes also accept JSON POST requests.
        const post = await get(route, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });
        assert.equal(post.status, 200);
        await post.arrayBuffer();
    }

    for (const route of [
        "/api/insights",
        "/api/load/detail",
        "/api/reviews/week",
    ]) {
        assert.equal(isHonoRoute(route), true, `${route} must use Hono`);
        assert.equal(isHonoRoute(`${route}/extra`), false);
    }
} finally {
    await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
}
