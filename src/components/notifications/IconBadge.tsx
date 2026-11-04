import type { ReactNode } from "react";

export function IconBadge({
    tone,
    children,
}: {
    tone: "teal" | "gold";
    children: ReactNode;
}) {
    return (
        <span
            className={`icon-badge-${tone} mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full`}
        >
            {children}
        </span>
    );
}
