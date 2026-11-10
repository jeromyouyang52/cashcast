/** Original weather and UI icons, drawn for Cashcast. Colours come from CSS (currentColor + --sun etc.). */
import type { Weather } from "@/lib/types";

const CLOUD = "M7 18.5h10.2a3.8 3.8 0 0 0 .5-7.57A5.5 5.5 0 0 0 7.06 10 4.25 4.25 0 0 0 7 18.5Z";

export function WeatherIcon({ w, size = 24, title }: { w: Weather; size?: number; title?: string }) {
  return (
    <svg className={`wx wx-${w}`} width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {w === "sunny" && (
        <g className="sun">
          <circle cx="12" cy="12" r="4.6" fill="var(--sun)" />
          <g stroke="var(--sun)" strokeWidth="1.8" strokeLinecap="round">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <line key={a} x1="12" y1="2.6" x2="12" y2="4.6" transform={`rotate(${a} 12 12)`} />
            ))}
          </g>
        </g>
      )}
      {w === "cloudy" && (
        <>
          <circle cx="15.5" cy="8" r="3.4" fill="var(--sun)" opacity=".9" />
          <path d={CLOUD} fill="var(--cloud)" />
        </>
      )}
      {w === "rain" && (
        <>
          <path d={CLOUD} transform="translate(0 -3)" fill="var(--rain-cloud)" />
          <g stroke="var(--rain)" strokeWidth="1.8" strokeLinecap="round">
            <line x1="8.5" y1="18" x2="7.5" y2="21" />
            <line x1="12.5" y1="18" x2="11.5" y2="21" />
            <line x1="16.5" y1="18" x2="15.5" y2="21" />
          </g>
        </>
      )}
      {w === "storm" && (
        <>
          <path d={CLOUD} transform="translate(0 -3)" fill="var(--storm-cloud)" />
          <path d="M12.8 15.2 10 19.4h2.6l-1.2 3.4 3.8-5h-2.6l1.4-2.6Z" fill="var(--bolt)" />
          <g stroke="var(--rain)" strokeWidth="1.6" strokeLinecap="round">
            <line x1="7.5" y1="17.5" x2="6.8" y2="19.6" />
            <line x1="17.6" y1="17.5" x2="16.9" y2="19.6" />
          </g>
        </>
      )}
    </svg>
  );
}

export function Tombstone({ bloom }: { bloom: boolean }) {
  return (
    <svg className={`stone ${bloom ? "bloom" : ""}`} width="64" height="72" viewBox="0 0 64 72" aria-hidden="true">
      <path d="M12 68V28a20 20 0 0 1 40 0v40Z" fill="var(--stone)" />
      <rect x="6" y="66" width="52" height="5" rx="2.5" fill="var(--ground)" />
      {!bloom && <path d="M32 18v14M26 23h12" stroke="var(--stone-mark)" strokeWidth="2.4" strokeLinecap="round" />}
      {bloom && (
        <g className="flowers" transform="translate(32 66) scale(1.25) translate(-32 -66)">
          <path d="M18 66c0-6 2-10 4-12M46 66c0-6-2-10-4-12M32 66V52" stroke="var(--leaf)" strokeWidth="2" fill="none" strokeLinecap="round" />
          {[
            [22, 52],
            [42, 52],
            [32, 48],
          ].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              {[0, 72, 144, 216, 288].map((a) => (
                <ellipse key={a} cx="0" cy="-3.2" rx="2.2" ry="3.2" fill="var(--petal)" transform={`rotate(${a})`} />
              ))}
              <circle r="1.8" fill="var(--sun)" />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

export function Gear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

export function Lock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="15" cy="9" r="4.2" fill="var(--sun)" />
      <path d="M6.5 19h10a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.1 11.5 3.8 3.8 0 0 0 6.5 19Z" fill="var(--fg)" />
    </svg>
  );
}
