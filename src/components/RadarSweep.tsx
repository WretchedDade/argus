import { useId } from "react";

// The sweep speeds up while a poll runs.
export function RadarSweep({
    size = 26,
    watching = false,
    forceAnimation = false,
}: {
    size?: number;
    watching?: boolean;
    forceAnimation?: boolean;
}) {
    const gradientId = useId();
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
        >
            <defs>
                <radialGradient
                    id={gradientId}
                    cx="12"
                    cy="12"
                    r="10.5"
                    gradientUnits="userSpaceOnUse"
                >
                    <stop
                        offset="0"
                        stopColor="var(--mantine-primary-color-filled)"
                        stopOpacity="0.5"
                    />
                    <stop
                        offset="1"
                        stopColor="var(--mantine-primary-color-filled)"
                        stopOpacity="0"
                    />
                </radialGradient>
            </defs>
            <g stroke="currentColor">
                <circle
                    cx="12"
                    cy="12"
                    r="10"
                    strokeOpacity="0.3"
                    strokeWidth="1.4"
                />
                <circle
                    cx="12"
                    cy="12"
                    r="6"
                    strokeOpacity="0.45"
                    strokeWidth="1.4"
                />
            </g>
            <g
                className={`radar-sweep${watching ? " radar-fast" : ""}`}
                data-force-animation={forceAnimation || undefined}
                style={{
                    transformBox: "view-box",
                    transformOrigin: "12px 12px",
                }}
            >
                <path
                    d="M12 12 L12 1.5 A10.5 10.5 0 0 1 20.5 6 Z"
                    fill={`url(#${gradientId})`}
                />
                <line
                    x1="12"
                    y1="12"
                    x2="12"
                    y2="1.5"
                    stroke="var(--mantine-primary-color-filled)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                />
            </g>
            <circle
                cx="16.5"
                cy="8.5"
                r="1.1"
                fill="var(--mantine-primary-color-filled)"
                className={watching ? "watch-pulse" : undefined}
            />
        </svg>
    );
}
