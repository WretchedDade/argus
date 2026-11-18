import type { ReactNode } from "react";
import { Box, VisuallyHidden } from "@mantine/core";

export function AccessibleChart({
    summary,
    columns,
    rows,
    children,
}: {
    summary: string;
    columns: string[];
    rows: (string | number)[][];
    children: ReactNode;
}) {
    return (
        <Box role="group" aria-label={summary}>
            {children}
            <VisuallyHidden component="table">
                <caption>{summary}</caption>
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column} scope="col">
                                {column}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr>
                            <td colSpan={columns.length}>No data</td>
                        </tr>
                    ) : (
                        rows.map((row, index) => (
                            <tr key={index}>
                                {row.map((cell, cellIndex) => (
                                    <td key={cellIndex}>{cell}</td>
                                ))}
                            </tr>
                        ))
                    )}
                </tbody>
            </VisuallyHidden>
        </Box>
    );
}
