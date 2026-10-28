import { useQuery } from "@tanstack/react-query";
import { healthQuery } from "../lib/api";
import { RadarSweep } from "./RadarSweep";

// The brand mark. Single swap point: change the mark here, or render an image
// asset from src/assets, without touching the header layout. The beam speeds up
// while the poller is actively running a cycle.
export function BrandMark({ size = 34 }: { size?: number }) {
    const health = useQuery(healthQuery);
    return <RadarSweep size={size} watching={!!health.data?.poller.running} />;
}
