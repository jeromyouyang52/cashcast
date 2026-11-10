"use client";

/** Animates a money figure to its new value. Screen readers and reduced-motion users get the final value only. */
import { useEffect, useRef, useState } from "react";
import { cad } from "@/lib/ui";

export function CountUp({ value, ms = 700 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(start + (value - start) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return (
    <>
      <span aria-hidden="true">{cad(Math.round(shown))}</span>
      <span className="sr">{cad(value)}</span>
    </>
  );
}
