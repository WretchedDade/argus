import { useState } from "react";
import { Badge, Button, Group, Popover, Select, Stack } from "@mantine/core";
import { ListFilter } from "lucide-react";
import type { Pr } from "../lib/api";
import {
    queueFilterOptions,
    type QueueFilters as Filters,
} from "../lib/queue-filters";

const fields = [
    { key: "group", label: "Required Approver Group", all: "All groups" },
    { key: "creator", label: "PR Creator", all: "All creators" },
    { key: "repository", label: "Repository", all: "All repositories" },
] as const;

function FilterDraft({
    prs,
    value,
    labels,
    onApply,
}: {
    prs: Pr[];
    value: Filters;
    labels: Record<string, string>;
    onApply: (filters: Filters) => void;
}) {
    const [draft, setDraft] = useState(value);
    const options = queueFilterOptions(prs);
    return (
        <Stack gap="sm">
            {fields.map(({ key, label, all }) => {
                const selected = draft[key];
                const choices =
                    selected && !options[key].includes(selected)
                        ? [selected, ...options[key]]
                        : options[key];
                return (
                    <Select
                        key={key}
                        name={key}
                        label={label}
                        placeholder={all}
                        value={selected ?? null}
                        searchable
                        comboboxProps={{ withinPortal: false }}
                        clearable
                        nothingFoundMessage="No matches."
                        data={choices.map((option) => ({
                            value: option,
                            label:
                                key === "group"
                                    ? labels[option] || option
                                    : option,
                        }))}
                        filter={({ options, search }) =>
                            options.filter(
                                (option) =>
                                    "value" in option &&
                                    `${option.label} ${option.value}`
                                        .toLocaleLowerCase()
                                        .includes(
                                            search.trim().toLocaleLowerCase(),
                                        ),
                            )
                        }
                        onChange={(option) =>
                            setDraft((current) => ({
                                ...current,
                                [key]: option ?? undefined,
                            }))
                        }
                    />
                );
            })}
            <Group justify="space-between">
                <Button variant="subtle" onClick={() => setDraft({})}>
                    Reset
                </Button>
                <Button onClick={() => onApply(draft)}>Apply</Button>
            </Group>
        </Stack>
    );
}

export function QueueFilters({
    prs,
    value,
    labels,
    onChange,
}: {
    prs: Pr[];
    value: Filters;
    labels: Record<string, string>;
    onChange: (filters: Filters) => void;
}) {
    const [opened, setOpened] = useState(false);
    const activeCount = fields.filter(({ key }) => !!value[key]).length;
    return (
        <section
            aria-label="Filter review queue"
            className="ml-auto flex shrink-0 items-center gap-2"
        >
            <Popover
                opened={opened}
                onChange={setOpened}
                position="bottom-end"
                width={320}
                trapFocus
                shadow="md"
                withinPortal
            >
                <Popover.Target>
                    <Button
                        variant="default"
                        leftSection={<ListFilter size={14} />}
                        rightSection={
                            activeCount > 0 ? (
                                <Badge size="sm">{activeCount}</Badge>
                            ) : undefined
                        }
                        onClick={() => setOpened((value) => !value)}
                    >
                        Filters
                    </Button>
                </Popover.Target>
                <Popover.Dropdown aria-label="Filters" maw="calc(100vw - 2rem)">
                    {opened && (
                        <FilterDraft
                            prs={prs}
                            value={value}
                            labels={labels}
                            onApply={(filters) => {
                                onChange(filters);
                                setOpened(false);
                            }}
                        />
                    )}
                </Popover.Dropdown>
            </Popover>
            {activeCount > 0 && (
                <Button variant="subtle" onClick={() => onChange({})}>
                    Clear Filters
                </Button>
            )}
        </section>
    );
}
