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

function relativeLuminance(channels: readonly number[]) {
    const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function backgroundScheme(
    red: number,
    green: number,
    blue: number,
): ColorScheme {
    return relativeLuminance([red, green, blue]) < 0.179 ? "dark" : "light";
}

export function darkPaletteForBackground(
    red: number,
    green: number,
    blue: number,
) {
    const channels = (amount: number) =>
        [red, green, blue].map((channel) =>
            Math.round(
                amount >= 0
                    ? channel + (255 - channel) * amount
                    : channel * (1 + amount),
            ),
        );
    const mix = (amount: number) =>
        `#${channels(amount)
            .map((channel) => channel.toString(16).padStart(2, "0"))
            .join("")}`;
    const fitMix = (
        preferred: number,
        safe: number,
        readable: (luminance: number) => boolean,
    ) => {
        if (readable(relativeLuminance(channels(preferred)))) return preferred;
        let failed = preferred;
        let passed = safe;
        for (let step = 0; step < 16; step++) {
            const candidate = (failed + passed) / 2;
            if (readable(relativeLuminance(channels(candidate))))
                passed = candidate;
            else failed = candidate;
        }
        return passed;
    };
    const surfaceMix = fitMix(
        0.1,
        0,
        (luminance) => 1.05 / (luminance + 0.05) >= 4.5,
    );
    const surfaceLuminance = relativeLuminance(channels(surfaceMix));
    const textMix = fitMix(
        0.5,
        1,
        (luminance) => (luminance + 0.05) / (surfaceLuminance + 0.05) >= 4.5,
    );
    // Mantine uses shade 7 for the page and shade 6 for raised surfaces.
    return [
        mix(Math.max(0.78, textMix)),
        mix(Math.max(0.68, textMix)),
        mix(textMix),
        mix(0.24),
        mix(0.16),
        mix(surfaceMix),
        mix(Math.min(0.04, surfaceMix)),
        mix(0),
        mix(-0.12),
        mix(-0.24),
    ] as const;
}
