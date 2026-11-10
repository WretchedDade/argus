import { SegmentedControl } from "@mantine/core";

export function SegToggle<T extends string | number>({
    value,
    onChange,
    options,
}: {
    value: T;
    onChange: (value: T) => void;
    options: { v: T; label: string }[];
}) {
    return (
        <SegmentedControl
            size="xs"
            value={String(value)}
            data={options.map((option) => ({
                value: String(option.v),
                label: option.label,
            }))}
            onChange={(selected) => {
                const option = options.find(
                    (item) => String(item.v) === selected,
                );
                if (!option) throw new Error(`Unknown option: ${selected}`);
                onChange(option.v);
            }}
        />
    );
}
