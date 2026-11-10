import {
    Badge,
    TagsInput,
    TextInput,
    createTheme,
    getThemeColor,
} from "@mantine/core";

export const argusTheme = createTheme({
    autoContrast: true,
    defaultRadius: "md",
    fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", sans-serif',
    components: {
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
