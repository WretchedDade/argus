import { ActionIcon, Group, Select, Stack, TextInput } from "@mantine/core";
import { X } from "lucide-react";

function guessLabel(name: string): string {
    return (name.split("\\").pop() ?? name).trim();
}

export function TeamLabelEditor({
    value,
    options,
    onChange,
    onBlur,
}: {
    value: Record<string, string>;
    options: string[];
    onChange: (value: Record<string, string>) => void;
    onBlur?: () => void;
}) {
    return (
        <Stack gap="xs">
            {Object.entries(value).map(([name, label]) => (
                <Group key={name} wrap="nowrap" gap="xs" align="flex-end">
                    <TextInput
                        label={name}
                        styles={{ label: { overflowWrap: "anywhere" } }}
                        aria-label={`Label for ${name}`}
                        value={label}
                        onChange={(event) =>
                            onChange({
                                ...value,
                                [name]: event.currentTarget.value,
                            })
                        }
                        onBlur={onBlur}
                        flex={1}
                        miw={0}
                    />
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="input-sm"
                        aria-label={`Remove label for ${name}`}
                        onClick={() => {
                            const next = { ...value };
                            delete next[name];
                            onChange(next);
                        }}
                    >
                        <X size={14} />
                    </ActionIcon>
                </Group>
            ))}
            <Select
                aria-label="Add a team to label"
                placeholder="Add a team to label"
                searchable
                clearable
                value={null}
                data={[...new Set(options)].filter((name) => !(name in value))}
                nothingFoundMessage="No teams without labels"
                onBlur={onBlur}
                onChange={(name) => {
                    if (name !== null)
                        onChange({ ...value, [name]: guessLabel(name) });
                }}
            />
        </Stack>
    );
}
