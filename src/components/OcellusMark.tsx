// An ocellus — the peacock's eye-spot: concentric rings around a jewel core.
// Reads as "a watchful eye" without being a literal (creepy) eyeball.
export function OcellusMark({ size = 24 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
        >
            <circle
                cx="12"
                cy="12"
                r="10.5"
                stroke="var(--mantine-color-green-6)"
                strokeWidth="1.4"
                strokeOpacity="0.55"
            />
            <circle
                cx="12"
                cy="12"
                r="8"
                stroke="var(--mantine-primary-color-filled)"
                strokeWidth="1.6"
            />
            <circle
                cx="12"
                cy="12"
                r="5"
                stroke="var(--mantine-color-blue-6)"
                strokeWidth="1.6"
            />
            <circle
                cx="12"
                cy="12"
                r="2.6"
                fill="var(--mantine-color-orange-6)"
            />
            <circle
                cx="12"
                cy="12"
                r="1"
                fill="var(--mantine-color-violet-6)"
            />
        </svg>
    );
}

// A tiny ocellus for inline status on the header band: gold ring, white core.
export function OcellusDot({
    size = 12,
    watching = false,
}: {
    size?: number;
    watching?: boolean;
}) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 12 12"
            fill="none"
            className={watching ? "watch-pulse" : undefined}
            aria-hidden
        >
            <circle
                cx="6"
                cy="6"
                r="4.5"
                stroke={
                    watching
                        ? "var(--mantine-primary-color-filled)"
                        : "currentColor"
                }
                strokeWidth="1.4"
            />
            <circle
                cx="6"
                cy="6"
                r="1.8"
                fill={
                    watching
                        ? "var(--mantine-primary-color-filled)"
                        : "currentColor"
                }
            />
        </svg>
    );
}
