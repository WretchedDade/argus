import {
    Alert,
    NativeSelect,
    Paper,
    SegmentedControl,
    Stack,
    Switch,
    Text,
} from "@mantine/core";
import { ACCENTS, appearanceSchema } from "../lib/appearance";
import { useAppearance } from "./AppearanceProvider";

export function AppearanceSettings() {
    const { appearance, updateAppearance, error } = useAppearance();
    return (
        <Paper withBorder p="md">
            <Stack gap="sm">
                <Text fw={600}>Appearance</Text>
                <Text size="sm" c="dimmed">
                    Choose the color mode and accent for controls and charts.
                    Appearance changes apply at once.
                </Text>
                {error && (
                    <Alert color="red" title="Appearance settings">
                        {error}
                    </Alert>
                )}
                <Text size="sm" id="appearance-mode-label">
                    Color mode
                </Text>
                <SegmentedControl
                    aria-labelledby="appearance-mode-label"
                    value={appearance.mode}
                    onChange={(mode) =>
                        updateAppearance(
                            appearanceSchema.parse({ ...appearance, mode }),
                        )
                    }
                    data={[
                        { value: "auto", label: "Auto" },
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" },
                    ]}
                />
                <NativeSelect
                    label="Accent color"
                    value={appearance.accent}
                    data={ACCENTS.map((value) => ({
                        value,
                        label: value[0].toUpperCase() + value.slice(1),
                    }))}
                    onChange={(event) =>
                        updateAppearance(
                            appearanceSchema.parse({
                                ...appearance,
                                accent: event.currentTarget.value,
                            }),
                        )
                    }
                />
                <Switch
                    label="Always animate the radar"
                    description="Keep the radar rotating when your system requests reduced motion. Other animations still follow that preference."
                    checked={appearance.forceRadarAnimation}
                    onChange={(event) =>
                        updateAppearance({
                            ...appearance,
                            forceRadarAnimation: event.currentTarget.checked,
                        })
                    }
                />
                <Text size="xs" c="dimmed">
                    Auto uses the Copilot canvas background to select light or
                    dark. Without host colors, it uses your system preference.
                    Settings are saved in this browser, separately from your
                    Argus configuration.
                </Text>
            </Stack>
        </Paper>
    );
}
