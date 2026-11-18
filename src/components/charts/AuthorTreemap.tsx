import { Treemap } from "@mantine/charts";
import { getContrastColor, useMantineTheme } from "@mantine/core";
import { PIE_COLORS } from "./colors";

function AuthorTreemapTile({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    index = 0,
    depth = 0,
    name = "",
}: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    index?: number;
    depth?: number;
    name?: string;
}) {
    const theme = useMantineTheme();
    if (depth === 0) return null;
    const color = PIE_COLORS[index % PIE_COLORS.length];
    // Estimate available characters instead of measuring SVG text.
    const maxChars = Math.floor((width - 16) / 8);
    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={color}
                stroke="var(--chart-stroke-color, var(--mantine-color-body))"
            />
            {maxChars >= 2 && height >= 24 && (
                <text
                    x={x + width / 2}
                    y={y + height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={getContrastColor({
                        color,
                        theme,
                        autoContrast: true,
                    })}
                    fontSize={12}
                    fontFamily="var(--mantine-font-family)"
                >
                    {name.length > maxChars
                        ? `${name.slice(0, maxChars - 1)}…`
                        : name}
                </text>
            )}
        </g>
    );
}

export function AuthorTreemap({
    authors,
}: {
    authors: { label: string; count: number }[];
}) {
    return (
        <Treemap
            height={260}
            data={authors.map((author, index) => ({
                name: author.label,
                value: author.count,
                color: PIE_COLORS[index % PIE_COLORS.length],
            }))}
            autoContrast
            treemapProps={{ content: <AuthorTreemapTile /> }}
            valueFormatter={(count) => `${count} PR${count === 1 ? "" : "s"}`}
        />
    );
}
