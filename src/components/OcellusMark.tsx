// An ocellus — the peacock's eye-spot: concentric rings around a jewel core.
// Reads as "a watchful eye" without being a literal (creepy) eyeball.
export function OcellusMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10.5" stroke="var(--peacock-emerald)" strokeWidth="1.4" strokeOpacity="0.55" />
      <circle cx="12" cy="12" r="8" stroke="var(--peacock-teal)" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="5" stroke="var(--peacock-blue)" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.6" fill="var(--peacock-gold)" />
      <circle cx="12" cy="12" r="1" fill="var(--peacock-indigo)" />
    </svg>
  );
}

// A tiny ocellus for inline status on the header band: gold ring, white core.
export function OcellusDot({ size = 12, watching = false }: { size?: number; watching?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className={watching ? "watch-pulse" : undefined} aria-hidden>
      <circle cx="6" cy="6" r="4.5" stroke={watching ? "var(--peacock-gold)" : "rgba(255,255,255,0.55)"} strokeWidth="1.4" />
      <circle cx="6" cy="6" r="1.8" fill={watching ? "#ffffff" : "rgba(255,255,255,0.55)"} />
    </svg>
  );
}
