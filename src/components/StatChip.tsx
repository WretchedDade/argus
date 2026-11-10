// A tinted stat pill with muted theme text. Renders nothing for 0.
export function StatChip({
    label,
    value,
    color,
}: {
    label: string;
    value: number;
    color: string;
}) {
    if (!value) return null;
    return (
        <Badge
            component="span"
            variant="light"
            color={color}
            radius="sm"
            size="sm"
            className="tabular-nums"
        >
            {value} {label}
        </Badge>
    );
}
import { Badge } from "@mantine/core";
