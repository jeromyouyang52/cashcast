/**
 * A living sky behind the hero: gradient, sun glow, drifting clouds, rain, lightning.
 * Pure CSS + inline SVG (no video, no images, nothing fetched). One layer per weather,
 * cross-faded, so a purchase that turns today rainy visibly rolls the clouds in.
 * Fully decorative: aria-hidden, and frozen under prefers-reduced-motion.
 */
import type { Weather } from "@/lib/types";

const ORDER: Weather[] = ["sunny", "cloudy", "rain", "storm"];

function Cloud({ className }: { className: string }) {
  return (
    <svg className={`sky-cloud ${className}`} viewBox="0 0 120 50" aria-hidden="true">
      <path d="M20 46h78a18 18 0 0 0 1-36 26 26 0 0 0-49-4A20 20 0 0 0 20 46Z" />
    </svg>
  );
}

export function Sky({ w, full = false }: { w: Weather; full?: boolean }) {
  return (
    <div className={`sky ${full ? "sky-full" : ""}`} data-sky={w} aria-hidden="true">
      {ORDER.map((k) => (
        <div key={k} className={`sky-layer sky-${k}`} style={{ opacity: k === w ? 1 : 0 }} />
      ))}
      <div className="sky-glow" />
      <Cloud className="c1" />
      <Cloud className="c2" />
      <Cloud className="c3" />
      <div className="sky-drops" />
      <div className="sky-flash" />
    </div>
  );
}
