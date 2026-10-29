import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArgusStore } from "./db.ts";
import type { ArchivableSession, Pr } from "./types.ts";
import type { ArgusConfig, ConfigOverrides } from "./config.ts";
import { hasRequiredSetup, mergeConfig } from "./config.ts";
import type { PollerStatus, ReconcileSummary } from "./ado/poller.ts";
import { fetchAdoImage, isAllowedImageHost } from "./ado/images.ts";
import {
    authStatus,
    getRegistration,
    saveRegistration,
    type AdoRegistration,
    setAuthProvider,
    signIn,
    switchAccount,
    useBroker,
} from "./ado/client.ts";
import { sendJson } from "./respond.ts";

// Chat message asking to archive the review sessions of PRs that closed/merged.
function archivePrompt(items: ArchivableSession[]): string {
    const lines = items.map(
        (a) =>
            `- ${a.repo} #${a.number} (${a.status}) → session \`${a.sessionId}\``,
    );
    const staleN = items.filter((a) => a.status === "stale").length;
    const closedN = items.length - staleN;
    const parts = [
        closedN > 0 ? `${closedN} closed/merged` : null,
        staleN > 0
            ? `${staleN} stale (open but idle past the recency window)`
            : null,
    ].filter(Boolean);
    return [
        `Argus: ${items.length} tracked PR(s) have a linked review session with no further work (${parts.join(" and ")}). Please archive these review sessions:`,
        ``,
        ...lines,
    ].join("\n");
}

// The chat message dispatched when Review / Re-review is clicked. Review spawns a
// decoupled child session that runs the PR review skill; the skill records its own
// verdict with a headless HTTP POST to Argus's fixed-port ingest endpoint (no
// canvas, no per-session extension host), so nothing reports back to chat.
const INGEST = "http://127.0.0.1:48100/api/pr/record-review";
function recordCmd(canonical: string): string {
    return `Invoke-RestMethod -Method Post -Uri ${INGEST} -ContentType application/json -Body '{"canonical":"${canonical}","verdict":"<approved|suggestions|waiting|rejected>"}'`;
}
export function reviewPrompt(pr: Pr, skillName: string): string {
    const ref = `**${pr.repo} #${pr.number}** — ${pr.title}\n${pr.canonical}`;
    if (pr.reviewSessionId) {
        return [
            `Argus: time for a **re-review** of ${ref}`,
            ``,
            `The prior review ran in session \`${pr.reviewSessionId}\`. Send that session a message:`,
            `"Time for a re-review: check for new commits/updates on the PR and where things stand, review it with the user, then record the updated verdict yourself by running this in the session's terminal (no canvas needed): \`${recordCmd(pr.canonical)}\`. Do not report back here."`,
        ].join("\n");
    }
    return [
        `Argus: please **review** ${ref}`,
        `Lane: ${pr.lane === "quick" ? "quick" : "review"}`,
        ``,
        `Spawn a child session named concisely from the PR's subject with its number (3-5 words + " #${pr.number}", dropping filler like "add"/"update" and NOT prefixing "Review" — it's implied; e.g. "Add feature flags for Probadge" (#${pr.number}) → "Probadge Feature Flags #${pr.number}"), and run the ${skillName} skill on it. In the child session's kickoff prompt, include the line \`Lane: ${pr.lane === "quick" ? "quick" : "review"}\` so the ${skillName} skill branches into ${pr.lane === "quick" ? "quick" : "full"} mode automatically. Spawn it decoupled (\`coordinate_with_creator: false\`) so it does not report back into this chat. Spawn it in interactive mode (\`kickoff.mode: "interactive"\`), never autopilot.`,
        ``,
        `As soon as the session exists, invoke the Argus \`linkReviewSession\` action with \`{ "canonical": "${pr.canonical}", "sessionId": "<child session id>" }\`. You do NOT need to wait for or relay the outcome: when the review concludes, the review session records its own verdict headlessly by running \`${recordCmd(pr.canonical)}\` in its terminal — no canvas required. If that POST fails (Argus not running), it should surface the verdict to the user so they can record it manually.`,
    ].join("\n");
}

export function automaticReviewPrompt(pr: Pr, skillName: string): string {
    const ref = `**${pr.repo} #${pr.number}** — ${pr.title}\n${pr.canonical}`;
    return [
        `Argus: please run an **automatic review** of ${ref}`,
        `Lane: quick`,
        `Review mode: automatic`,
        ``,
        `Spawn a child session named concisely from the PR's subject with its number (3-5 words + " #${pr.number}", dropping filler like "add"/"update" and NOT prefixing "Review" — it's implied). Run the ${skillName} skill on it. The child kickoff prompt must include both \`Lane: quick\` and \`Review mode: automatic\`. Spawn it decoupled (\`coordinate_with_creator: false\`) with \`kickoff.mode: "autopilot"\`. Automatic mode is an in-depth full review, not the abbreviated quick-lane flow.`,
        ``,
        `As soon as the session exists, invoke the Argus \`linkReviewSession\` action with \`{ "canonical": "${pr.canonical}", "sessionId": "<child session id>" }\`. The child must review autonomously, but must not run local tests, builds, linters, typechecks, or other expensive validation commands. It must ignore every ADO PR validation, check, and policy status when deciding the verdict, including ownership enforcer, builds, tests, policies, required reviewers, and other merge gates; pending, unavailable, or failed merge validation is never a reason to wait. When the code review is complete and confident with zero findings, it must cast an ADO Approved vote and record Argus verdict \`approved\`. With any code finding, genuine uncertainty, inability to complete the code review, or operational failure, it must post no ADO comments, cast no ADO vote, record only a provisional Argus \`waiting\` verdict when possible, and leave a detailed blocker summary in its own chat. It must never claim success after a partial failure.`,
    ].join("\n");
}

export interface ApiContext {
    store: ArgusStore;
    bootAt: string;
    migrated: { imported: number };
    reconcile: () => Promise<ReconcileSummary | null>;
    refreshPr: (canonical: string) => Promise<void>;
    trackPr: (
        number: number,
    ) => Promise<{ ok: boolean; canonical?: string; reason?: string }>;
    recordReview: (
        canonical: string,
        opts: { verdict?: string; sha?: string; sessionId?: string },
    ) => void;
    dispatch: (message: string) => Promise<void>;
    pollerStatus: () => PollerStatus;
    getConfig: () => ArgusConfig;
    saveConfig: (overrides: ConfigOverrides) => ArgusConfig;
    markSetupComplete: () => void;
    installBaselineSkill: () => { installed: boolean; reason?: string };
}

async function readJsonBody(req: IncomingMessage): Promise<ConfigOverrides> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf-8").trim();
    return text ? (JSON.parse(text) as ConfigOverrides) : {};
}

function isMondayKey(key: string | null): key is string {
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        date.getDay() === 1
    );
}

// Handle an /api/* request. Returns false if the route isn't an API route, so
// the caller can fall through to static serving. New endpoints live here.
export async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: ApiContext,
): Promise<boolean> {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const route = url.pathname;
    if (!route.startsWith("/api/")) return false;

    if (route === "/api/health" || route.startsWith("/api/auth/"))
        setAuthProvider(ctx.getConfig().adoAuth); // another host may have saved a change

    if (route === "/api/auth/registration") {
        if (req.method === "POST") {
            try {
                saveRegistration(
                    (await readJsonBody(req)) as unknown as AdoRegistration,
                );
            } catch (error) {
                sendJson(res, 400, { error: (error as Error).message });
                return true;
            }
        }
        sendJson(res, 200, getRegistration());
        return true;
    }

    if (route === "/api/auth/status") {
        sendJson(res, 200, await authStatus());
        return true;
    }

    if (
        (route === "/api/auth/sign-in" ||
            route === "/api/auth/switch-account") &&
        req.method === "POST"
    ) {
        try {
            sendJson(
                res,
                200,
                await (route === "/api/auth/sign-in"
                    ? signIn()
                    : switchAccount()),
            );
        } catch (error) {
            sendJson(res, 502, {
                error:
                    error instanceof Error ? error.message : "Sign-in failed.",
            });
        }
        return true;
    }

    if (route === "/api/health") {
        sendJson(res, 200, {
            ok: true,
            boot_at: ctx.bootAt,
            store: ctx.store.counts(),
            migrated: ctx.migrated,
            poller: ctx.pollerStatus(),
            auth: useBroker() ? await authStatus() : null,
            setup_complete:
                ctx.store.isSetupComplete() &&
                hasRequiredSetup(ctx.getConfig()),
        });
        return true;
    }

    if (route === "/api/prs") {
        sendJson(res, 200, { prs: ctx.store.listPrs() });
        return true;
    }

    if (route === "/api/pr") {
        const canonical = url.searchParams.get("canonical");
        if (!canonical) sendJson(res, 400, { error: "canonical required" });
        else
            sendJson(res, 200, {
                pr: ctx.store.getPr(canonical),
                events: ctx.store.listEvents(canonical),
                deploy: ctx.store.getDeploy(canonical),
            });
        return true;
    }

    if (route === "/api/deploys") {
        const cfg = ctx.getConfig();
        sendJson(res, 200, {
            window: cfg.deployWindowDays,
            timeline: ctx.store.deployTimeline(
                cfg.deployWindowDays,
                Object.keys(cfg.repoPipelines),
            ),
        });
        return true;
    }

    if (route === "/api/pr/find") {
        const number = Number(url.searchParams.get("number"));
        if (!Number.isInteger(number) || number <= 0)
            sendJson(res, 400, { error: "valid number required" });
        else
            sendJson(res, 200, {
                canonical: ctx.store.findCanonicalByNumber(number),
            });
        return true;
    }

    if (route === "/api/pr/track" && req.method === "POST") {
        const body = (await readJsonBody(req)) as unknown as {
            number?: number;
        };
        const number = Number(body.number);
        if (!Number.isInteger(number) || number <= 0)
            sendJson(res, 400, { error: "valid number required" });
        else {
            const result = await ctx.trackPr(number);
            sendJson(res, result.ok ? 200 : 409, result);
        }
        return true;
    }

    if (route === "/api/pr/refresh" && req.method === "POST") {
        const body = (await readJsonBody(req)) as unknown as {
            canonical?: string;
        };
        if (!body.canonical)
            sendJson(res, 400, { error: "canonical required" });
        else {
            await ctx.refreshPr(body.canonical);
            sendJson(res, 200, { pr: ctx.store.getPr(body.canonical) });
        }
        return true;
    }

    if (route === "/api/pr/snooze" && req.method === "POST") {
        const body = (await readJsonBody(req)) as unknown as {
            canonical?: string;
            until?: string | null;
            mode?: "time" | "fte" | null;
        };
        if (!body.canonical)
            sendJson(res, 400, { error: "canonical required" });
        else {
            ctx.store.setSnooze(
                body.canonical,
                body.until ?? null,
                body.mode ?? (body.until ? "time" : null),
            );
            sendJson(res, 200, { pr: ctx.store.getPr(body.canonical) });
        }
        return true;
    }

    if (route === "/api/pr/lane" && req.method === "POST") {
        const body = (await readJsonBody(req)) as unknown as {
            canonical?: string;
            lane?: string;
        };
        if (
            !body.canonical ||
            (body.lane !== "quick" && body.lane !== "review")
        ) {
            sendJson(res, 400, {
                error: "canonical and lane (quick|review) required",
            });
        } else {
            ctx.store.setLane(body.canonical, body.lane);
            sendJson(res, 200, { pr: ctx.store.getPr(body.canonical) });
        }
        return true;
    }

    if (route === "/api/pr/review" && req.method === "POST") {
        const body = (await readJsonBody(req)) as unknown as {
            canonical?: string;
            automatic?: boolean;
        };
        const pr = body.canonical ? ctx.store.getPr(body.canonical) : null;
        if (!pr)
            sendJson(res, 400, { error: "canonical required / not found" });
        else if (
            body.automatic !== undefined &&
            typeof body.automatic !== "boolean"
        )
            sendJson(res, 400, { error: "automatic must be boolean" });
        else if (body.automatic && pr.lane !== "quick")
            sendJson(res, 400, {
                error: "automatic review requires quick lane",
            });
        else {
            await ctx.dispatch(
                body.automatic
                    ? automaticReviewPrompt(pr, ctx.getConfig().reviewSkillName)
                    : reviewPrompt(pr, ctx.getConfig().reviewSkillName),
            );
            sendJson(res, 200, { ok: true, reReview: !!pr.reviewSessionId });
        }
        return true;
    }

    if (route === "/api/pr/record-review" && req.method === "POST") {
        const body = (await readJsonBody(req)) as unknown as {
            canonical?: string;
            verdict?: string;
            sha?: string;
            sessionId?: string;
        };
        if (!body.canonical)
            sendJson(res, 400, { error: "canonical required" });
        else {
            ctx.recordReview(body.canonical, {
                verdict: body.verdict,
                sha: body.sha,
                sessionId: body.sessionId,
            });
            sendJson(res, 200, { ok: true });
        }
        return true;
    }

    if (route === "/api/pr/remove" && req.method === "POST") {
        const body = (await readJsonBody(req)) as unknown as {
            canonical?: string;
        };
        if (!body.canonical)
            sendJson(res, 400, { error: "canonical required" });
        else {
            ctx.store.removePr(body.canonical);
            sendJson(res, 200, { ok: true });
        }
        return true;
    }

    if (route === "/api/pr/scope" && req.method === "POST") {
        const body = (await readJsonBody(req)) as unknown as {
            canonical?: string;
            outOfScope?: boolean;
        };
        if (!body.canonical)
            sendJson(res, 400, { error: "canonical required" });
        else {
            ctx.store.setOutOfScope(body.canonical, !!body.outOfScope);
            sendJson(res, 200, { pr: ctx.store.getPr(body.canonical) });
        }
        return true;
    }

    if (route === "/api/img") {
        const target = url.searchParams.get("url");
        if (!target || !isAllowedImageHost(target)) {
            res.writeHead(400).end("bad url");
            return true;
        }
        try {
            const img = await fetchAdoImage(target);
            res.writeHead(img.status, {
                "content-type": img.contentType,
                "cache-control": "private, max-age=3600",
            });
            res.end(img.body);
        } catch {
            res.writeHead(502).end("image proxy error");
        }
        return true;
    }

    if (route === "/api/refresh" && req.method === "POST") {
        sendJson(res, 200, { summary: await ctx.reconcile() });
        return true;
    }

    if (route === "/api/config") {
        if (req.method === "POST") {
            const config = ctx.saveConfig(await readJsonBody(req));
            setAuthProvider(config.adoAuth);
            sendJson(res, 200, { config });
        } else sendJson(res, 200, { config: ctx.getConfig() });
        return true;
    }

    // First-run setup: save the config the user entered and mark setup done, so the
    // UI switches from the setup gate to the board. Optionally installs the bundled
    // baseline pr-review skill. Body is config overrides plus installPrReviewSkill.
    if (route === "/api/setup" && req.method === "POST") {
        const body = (await readJsonBody(req)) as ConfigOverrides & {
            installPrReviewSkill?: boolean;
        };
        const { installPrReviewSkill, ...overrides } = body;
        if (!hasRequiredSetup(mergeConfig(ctx.getConfig(), overrides))) {
            sendJson(res, 400, {
                error: "Valid org URL, org slug, and project required",
            });
            return true;
        }
        const config = ctx.saveConfig(overrides);
        ctx.markSetupComplete();
        const skill = installPrReviewSkill
            ? ctx.installBaselineSkill()
            : { installed: false, reason: "skipped" };
        sendJson(res, 200, { config, setup_complete: true, skill });
        return true;
    }

    if (route === "/api/load/detail") {
        const key = url.searchParams.get("key");
        const granularity = url.searchParams.get("granularity");
        if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key))
            sendJson(res, 400, { error: "key (YYYY-MM-DD) required" });
        else if (granularity !== "day" && granularity !== "week")
            sendJson(res, 400, { error: "granularity (day or week) required" });
        else {
            const cfg = ctx.getConfig();
            const work = { endHour: cfg.workEndHour, days: cfg.workDays };
            const detail =
                granularity === "week"
                    ? ctx.store.loadWeekDetail(key, cfg.recencyDays, work)
                    : ctx.store.loadDayDetail(key, cfg.recencyDays, work);
            sendJson(res, 200, { detail });
        }
        return true;
    }

    if (route === "/api/changes") {
        sendJson(res, 200, { changes: ctx.store.listUnreadChanges() });
        return true;
    }

    if (route === "/api/insights") {
        const cfg = ctx.getConfig();
        sendJson(res, 200, {
            insights: ctx.store.computeInsights(cfg.recencyDays, {
                endHour: cfg.workEndHour,
                days: cfg.workDays,
            }),
        });
        return true;
    }

    if (route === "/api/reviews/week") {
        const key = url.searchParams.get("key");
        if (!isMondayKey(key))
            sendJson(res, 400, {
                error: "key must be a Monday in YYYY-MM-DD format",
            });
        else sendJson(res, 200, { facts: ctx.store.weeklyReviewFacts(key) });
        return true;
    }

    if (route === "/api/changes/read" && req.method === "POST") {
        const { canonical } = (await readJsonBody(req)) as {
            canonical?: string;
        };
        if (!canonical) {
            sendJson(res, 400, { error: "canonical required" });
            return true;
        }
        ctx.store.markChangesReadForPr(canonical);
        sendJson(res, 200, { ok: true });
        return true;
    }

    if (route === "/api/changes/read-all" && req.method === "POST") {
        ctx.store.markAllChangesRead();
        sendJson(res, 200, { ok: true });
        return true;
    }

    if (route === "/api/archivable") {
        sendJson(res, 200, {
            archivable: ctx.store.getArchivable(ctx.getConfig().recencyDays),
        });
        return true;
    }

    if (route === "/api/archive" && req.method === "POST") {
        const items = ctx.store.getArchivable(ctx.getConfig().recencyDays);
        if (items.length > 0) {
            await ctx.dispatch(archivePrompt(items));
            ctx.store.markReviewSessionsArchived(items.map((i) => i.sessionId));
        }
        sendJson(res, 200, { dispatched: items.length });
        return true;
    }

    if (route === "/api/teams") {
        sendJson(res, 200, { teams: ctx.store.getSeenTeams() });
        return true;
    }

    if (route === "/api/activity") {
        const limit = Number(url.searchParams.get("limit") ?? 100);
        sendJson(res, 200, { entries: ctx.store.listActivity(limit) });
        return true;
    }

    // Windowed PR activity feed for external consumers (Clio's capture pulse).
    // ?since=<ISO8601>&until=<ISO8601>; until defaults to now, since to 24h before
    // until. Events with ts in [since, until), time-ordered ascending.
    if (route === "/api/pr-activity") {
        const nowMs = Date.now();
        const untilRaw = url.searchParams.get("until");
        const sinceRaw = url.searchParams.get("since");
        const untilMs = untilRaw ? Date.parse(untilRaw) : nowMs;
        if (Number.isNaN(untilMs)) {
            sendJson(res, 400, { error: "until must be ISO8601" });
            return true;
        }
        const sinceMs = sinceRaw
            ? Date.parse(sinceRaw)
            : untilMs - 24 * 60 * 60 * 1000;
        if (Number.isNaN(sinceMs)) {
            sendJson(res, 400, { error: "since must be ISO8601" });
            return true;
        }
        sendJson(res, 200, {
            since: new Date(sinceMs).toISOString(),
            until: new Date(untilMs).toISOString(),
            generatedAt: new Date().toISOString(),
            events: ctx.store.listPrActivity(sinceMs, untilMs),
        });
        return true;
    }

    if (route === "/api/runs") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        sendJson(res, 200, { runs: ctx.store.listPollRuns(limit) });
        return true;
    }

    if (route === "/api/run") {
        const id = Number(url.searchParams.get("id"));
        if (!id) sendJson(res, 400, { error: "id required" });
        else
            sendJson(res, 200, {
                run: ctx.store.getRun(id),
                entries: ctx.store.listActivityForRun(id),
                changes: ctx.store.listRunEvents(id),
            });
        return true;
    }

    sendJson(res, 404, { error: "not found" });
    return true;
}
