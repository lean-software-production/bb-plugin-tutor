import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { loopPath, type Loop } from "../../sketch/loop-geometry.ts";
import { cx } from "../../sketch/tone.ts";

/** Under this width there is no room for the loop without crossing text, so it is not drawn. */
const MIN_WIDTH = 360;
/** How far in from the stats' right edge the loop leaves. */
const FROM_INSET = 28;
/** How far along "What's next" the loop arrives, at most. */
const TO_INSET = 44;
/** The floor sits this far above the bottom of the reserved band. */
const FLOOR_MARGIN = 10;

type LoopArrowProps = {
  /** The stats the loop leaves from (it starts under their right end). */
  from: RefObject<HTMLElement | null>;
  /** "What's next", which the loop points at. */
  to: RefObject<HTMLElement | null>;
  /** The band the loop reserves below the row, in px. */
  depth?: number;
  className?: string;
};

/**
 * The lesson-complete loop back to "What's next" (app/sketch/loop-geometry.ts).
 * Renders the band it curls in, in flow below the row, and an <svg> drawn at
 * 1:1 in the measured gap between its two anchors, re-measured whenever
 * either anchor or the band resizes. Decoration only: aria-hidden.
 */
export function LoopArrow({ from, to, depth = 58, className }: LoopArrowProps) {
  const band = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState<Loop | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const [b, f, t] = [band.current, from.current, to.current];
      if (!b || !f || !t) return setLoop(null);
      const origin = b.getBoundingClientRect();
      if (origin.width < MIN_WIDTH) return setLoop(null);
      const stats = f.getBoundingClientRect();
      const next = t.getBoundingClientRect();
      setLoop(
        loopPath(
          { x: stats.right - FROM_INSET - origin.left, y: stats.bottom - origin.top },
          { x: next.left + Math.min(TO_INSET, next.width / 2) - origin.left, y: next.bottom - origin.top },
          depth - FLOOR_MARGIN,
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [band.current, from.current, to.current]) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [from, to, depth]);

  return (
    <div ref={band} className={cx("tp-loop", className)} style={{ height: depth }} aria-hidden="true">
      {loop && (
        <svg
          className="sk-loop tp-loop-svg"
          viewBox={loop.viewBox}
          style={{ left: loop.box.x, top: loop.box.y, width: loop.box.width, height: loop.box.height }}
        >
          <path
            d={loop.d}
            fill="none"
            strokeWidth={5}
            strokeLinecap="round"
            markerEnd="url(#tutor-sk-head)"
            filter="url(#tutor-sk-wobble-soft)"
          />
        </svg>
      )}
    </div>
  );
}
