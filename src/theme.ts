import {
    Badge,
    Button,
    TagsInput,
    TextInput,
    createTheme,
    getThemeColor,
} from "@mantine/core";
import { ChartLegend } from "@mantine/charts";
import { darkPaletteForBackground } from "./lib/appearance";

export const argusTheme = createTheme({
    autoContrast: true,
    respectReducedMotion: true,
    defaultRadius: "md",
    fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", sans-serif',
    colors: {
        dark: darkPaletteForBackground(13, 17, 23),
    },
    components: {
        Button: Button.extend({
            styles: {
                // Transitions omit the centering transform with reduced motion.
                loader: { transform: "translate(-50%, -50%)" },
            },
        }),
        ChartLegend: ChartLegend.extend({
            styles: {
                legendItem: { maxWidth: "100%", minWidth: 0 },
                legendItemName: {
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                },
            },
        }),
        Badge: Badge.extend({
            defaultProps: { tt: "none" },
            vars: (theme, props) => ({
                root:
                    props.variant === "light"
                        ? {
                              "--badge-color": `color-mix(in srgb, ${getThemeColor(props.color ?? theme.primaryColor, theme)} 20%, var(--argus-tag-text))`,
                          }
                        : {},
            }),
        }),
        TextInput: TextInput.extend({ defaultProps: { size: "sm" } }),
        TagsInput: TagsInput.extend({ defaultProps: { size: "sm" } }),
    },
});
