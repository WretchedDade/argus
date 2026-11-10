import { TagsInput } from "@mantine/core";

export function TeamMultiSelect({
    value,
    options,
    onChange,
    onBlur,
}: {
    value: string[];
    options: string[];
    onChange: (value: string[]) => void;
    onBlur?: () => void;
}) {
    return (
        <TagsInput
            label="Team reviewer patterns"
            description="Pick a team, or enter a custom *glob* and press Enter."
            placeholder="Search teams or enter a pattern"
            value={value}
            data={[...new Set(options)]}
            onChange={onChange}
            onBlur={onBlur}
            splitChars={[]}
            isDuplicate={(tag, current) => current.includes(tag)}
        />
    );
}
