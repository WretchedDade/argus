// A radar with a sweeping beam over a static grid, plus a gold "detected" blip.
// The beam group rotates around the SVG center; the grid and blip hold. The
// sweep speeds up (via CSS) while a reconcile cycle is actively running.
export function RadarSweep({ size = 26, watching = false }: { size?: number; watching?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <radialGradient id="argus-sweep" cx="12" cy="12" r="10.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g stroke="#ffffff">
        <circle cx="12" cy="12" r="10" strokeOpacity="0.3" strokeWidth="1.4" />
        <circle cx="12" cy="12" r="6" strokeOpacity="0.45" strokeWidth="1.4" />
      </g>
      <g
        className={`radar-sweep${watching ? " radar-fast" : ""}`}
        style={{ transformBox: "view-box", transformOrigin: "12px 12px" }}
      >
        <path d="M12 12 L12 1.5 A10.5 10.5 0 0 1 20.5 6 Z" fill="url(#argus-sweep)" />
        <line x1="12" y1="12" x2="12" y2="1.5" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <circle cx="16.5" cy="8.5" r="1.1" fill="var(--peacock-gold)" className={watching ? "watch-pulse" : undefined} />
    </svg>
  );
}
