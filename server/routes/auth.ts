import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ApiContext } from "../api.ts";
import type { AppEnv } from "../app.ts";
import { resetIdentity } from "../ado/poller.ts";
import {
    authStatus,
    getRegistration,
    saveRegistration,
    setAuthProvider,
    signIn,
    signOut,
    switchAccount,
} from "../ado/client.ts";

// Bad types become "", so saveRegistration reports its "is required" message.
const registrationSchema = z.preprocess(
    (body) => body ?? {},
    z.object({
        clientId: z.string().catch(""),
        tenantId: z.string().catch(""),
    }),
);

// Errors thrown in these routes answer 502 with { error }; saveRegistration's answer 400.
const badRequest = <T>(run: () => T): T => {
    try {
        return run();
    } catch (error) {
        throw new HTTPException(400, { message: (error as Error).message });
    }
};

export function authRoutes(ctx: ApiContext) {
    const accountAction =
        (run: () => ReturnType<typeof authStatus>) => async () => {
            const status = await run();
            resetIdentity(ctx.store);
            return status;
        };

    return new Hono<AppEnv>()
        .use("*", async (_unused, next) => {
            setAuthProvider(ctx.getConfig().adoAuth); // another host may have saved a change
            await next();
        })
        .onError((error, honoContext) =>
            honoContext.json(
                { error: error.message || "Sign-in failed." },
                error instanceof HTTPException ? error.status : 502,
            ),
        )
        .get("/registration", (honoContext) =>
            honoContext.json(getRegistration()),
        )
        .post(
            "/registration",
            zValidator("json", registrationSchema),
            (honoContext) => {
                badRequest(() =>
                    saveRegistration(honoContext.req.valid("json")),
                );
                resetIdentity(ctx.store);
                return honoContext.json(getRegistration());
            },
        )
        .get("/status", async (honoContext) =>
            honoContext.json(await authStatus()),
        )
        .post("/sign-in", async (honoContext) =>
            honoContext.json(await accountAction(signIn)()),
        )
        .post("/switch-account", async (honoContext) =>
            honoContext.json(await accountAction(switchAccount)()),
        )
        .post("/sign-out", async (honoContext) =>
            honoContext.json(await accountAction(signOut)()),
        );
}
