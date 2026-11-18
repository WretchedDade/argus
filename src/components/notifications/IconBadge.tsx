import type { ReactNode } from "react";
import { ThemeIcon } from "@mantine/core";

export function IconBadge({
    tone,
    children,
}: {
    tone: "teal" | "gold";
    children: ReactNode;
}) {
    return (
        <ThemeIcon
            size={24}
            radius="xl"
            variant="light"
            color={tone === "gold" ? "orange" : undefined}
            className="shrink-0"
        >
            {children}
        </ThemeIcon>
    );
}
