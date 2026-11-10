import {
    ActionIcon,
    Group,
    Select,
    Stack,
    Text,
    TextInput,
} from "@mantine/core";
import { X } from "lucide-react";

function guessLabel(name: string): string {
    return (name.split("\\").pop() ?? name).trim();
}

export function TeamLabelEditor({
    value,
    options,
    onChange,
}: {
    value: Record<string, string>;
    options: string[];
    onChange: (value: Record<string, string>) => void;
}) {
    return (
        <Stack gap="xs">
            {Object.entries(value).map(([name, label]) => (
                <Group key={name} wrap="nowrap" gap="xs">
                    <Text
                        size="xs"
                        c="dimmed"
                        truncate
                        style={{ flex: 1 }}
                        title={name}
                    >
                        {name}
                    </Text>
                    <TextInput
                        aria-label={`Label for ${name}`}
                        value={label}
                        onChange={(event) =>
                            onChange({
                                ...value,
                                [name]: event.currentTarget.value,
                            })
                        }
                        w={140}
                    />
                    <ActionIcon
                        variant="subtle"
                        color="gray"
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
                onChange={(name) => {
                    if (name !== null)
                        onChange({ ...value, [name]: guessLabel(name) });
                }}
            />
        </Stack>
    );
}
