import { zValidator } from "@hono/zod-validator";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "./app.ts";

export function jsonBody<T extends z.ZodType>(
    schema: T,
    formatIssues: (issues: z.ZodError["issues"]) => string = (issues) =>
        issues[0].message,
) {
    return [
        createMiddleware<AppEnv>(async (c, next) => {
            // Legacy actions accept an empty body as an empty object.
            if (!(await c.req.raw.clone().text()).trim())
                c.req.raw = new Request(c.req.raw, { body: "{}" });
            await next();
        }),
        zValidator("json", schema, (result) => {
            if (!result.success)
                throw new HTTPException(400, {
                    message: formatIssues(result.error.issues),
                });
        }),
    ] as const;
}

export function queryParams<Output, Input>(schema: z.ZodType<Output, Input>) {
    return zValidator(
        "query",
        schema,
        (result) => {
            if (!result.success)
                throw new HTTPException(400, {
                    message: result.error.issues[0].message,
                });
        },
        {
            // Legacy queries use the first value of a repeated parameter.
            validationFunction: (schema, values) =>
                schema.safeParse(
                    Object.fromEntries(
                        Object.entries(values).map(([key, value]) => [
                            key,
                            Array.isArray(value) ? value[0] : value,
                        ]),
                    ),
                ),
        },
    );
}
