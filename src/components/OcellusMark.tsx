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
