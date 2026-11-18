import { z } from "zod";

export const APPEARANCE_KEY = "argus.appearance";
export const ACCENTS = ["blue", "violet", "cyan", "green", "orange"] as const;
export const appearanceSchema = z.object({
    mode: z.enum(["auto", "light", "dark"]),
    accent: z.enum(ACCENTS),
    forceRadarAnimation: z.boolean().default(false),
});
export type Appearance = z.infer<typeof appearanceSchema>;
export type ColorScheme = "light" | "dark";
export const DEFAULT_APPEARANCE: Appearance = {
    mode: "auto",
    accent: "blue",
    forceRadarAnimation: false,
};

export function parseAppearance(value: string | null): Appearance {
    return value === null
        ? { ...DEFAULT_APPEARANCE }
        : appearanceSchema.parse(JSON.parse(value));
}

export function resolveColorScheme(
    mode: Appearance["mode"],
    host: ColorScheme | null,
    systemDark: boolean,
): ColorScheme {
    return mode === "auto" ? (host ?? (systemDark ? "dark" : "light")) : mode;
}

export function backgroundScheme(
    red: number,
    green: number,
    blue: number,
): ColorScheme {
    const linear = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance =
        0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    return luminance < 0.179 ? "dark" : "light";
}
