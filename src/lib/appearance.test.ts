import assert from "node:assert/strict";
import { test } from "node:test";
import {
    ACCENTS,
    backgroundScheme,
    darkPaletteForBackground,
    parseAppearance,
    resolveColorScheme,
} from "./appearance.ts";

test("appearance defaults to automatic mode and blue", () => {
    assert.deepEqual(parseAppearance(null), {
        mode: "auto",
        accent: "blue",
        forceRadarAnimation: false,
    });
});

test("appearance accepts each curated accent and mode", () => {
    for (const mode of ["auto", "light", "dark"]) {
        for (const accent of ACCENTS) {
            assert.deepEqual(
                parseAppearance(JSON.stringify({ mode, accent })),
                {
                    mode,
                    accent,
                    forceRadarAnimation: false,
                },
            );
        }
    }
});

test("the radar override persists without changing mode or accent", () => {
    for (const forceRadarAnimation of [true, false]) {
        const appearance = {
            mode: "dark",
            accent: "violet",
            forceRadarAnimation,
        };
        assert.deepEqual(
            parseAppearance(JSON.stringify(appearance)),
            appearance,
        );
    }
});

test("invalid saved appearance is reported rather than silently accepted", () => {
    for (const value of [
        "{",
        "null",
        "{}",
        '{"mode":"auto","accent":"#ff0000"}',
        '{"mode":"unknown","accent":"blue"}',
        '{"mode":"auto","accent":"blue","forceRadarAnimation":"yes"}',
    ]) {
        assert.throws(() => parseAppearance(value));
    }
});

test("automatic mode uses host colors before system preferences", () => {
    assert.equal(resolveColorScheme("auto", "dark", false), "dark");
    assert.equal(resolveColorScheme("auto", "light", true), "light");
    assert.equal(resolveColorScheme("auto", null, true), "dark");
    assert.equal(resolveColorScheme("auto", null, false), "light");
});

test("explicit mode overrides both the host and the system", () => {
    assert.equal(resolveColorScheme("light", "dark", true), "light");
    assert.equal(resolveColorScheme("dark", "light", false), "dark");
});

test("host background classification uses relative luminance", () => {
    assert.equal(backgroundScheme(255, 255, 255), "light");
    assert.equal(backgroundScheme(246, 248, 250), "light");
    assert.equal(backgroundScheme(0, 0, 0), "dark");
    assert.equal(backgroundScheme(13, 17, 23), "dark");
    assert.equal(backgroundScheme(117, 117, 117), "dark");
    assert.equal(backgroundScheme(118, 118, 118), "light");
});

test("dark surfaces follow the host background with ordered neutral shades", () => {
    for (const background of [
        [13, 17, 23],
        [22, 27, 34],
        [32, 32, 32],
    ]) {
        const [red, green, blue] = background;
        const palette = darkPaletteForBackground(red, green, blue);
        const channels = palette.map((color) =>
            [1, 3, 5].map((offset) =>
                Number.parseInt(color.slice(offset, offset + 2), 16),
            ),
        );
        assert.deepEqual(channels[7], background);
        for (let index = 1; index < channels.length; index++) {
            assert.ok(
                channels[index].every(
                    (value, channel) => value <= channels[index - 1][channel],
                ),
                "Text, borders, and surfaces retain their light-to-dark order.",
            );
        }
        assert.ok(
            channels[6].every((value, channel) => value > background[channel]),
        );
        assert.ok(
            channels[8].every((value, channel) => value < background[channel]),
        );
    }
    assert.notDeepEqual(
        darkPaletteForBackground(13, 17, 23),
        darkPaletteForBackground(22, 27, 34),
        "Different host backgrounds in the same mode produce different palettes.",
    );
});
