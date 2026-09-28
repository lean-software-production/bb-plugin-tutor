// The lesson-complete loop-back arrow (app/ui/sketch/LoopArrow.tsx and the
// mockup's lesson-complete card). It leaves the stats on the right heading
// down, runs left along the floor of the gap below the row with one cursive
// curl on the way, and turns up to end under "What's next", heading at it.
// The kit's own arrow is a 1000×70 snippet that goes flat when stretched, so
// Tutor draws the path at the size it is shown (D10) and styles it with the
// kit's sk-loop class, arrowhead marker and wobble filter.

export interface Point {
  x: number;
  y: number;
}

export interface Loop {
  /** `M` then cubic `C` segments, in the anchors' coordinates. */
  d: string;
  /** The box to place the <svg> at, in the anchors' coordinates: the path plus room for stroke, arrowhead and wobble. */
  box: { x: number; y: number; width: number; height: number };
  /** Equal to the box, so the path is drawn 1:1, never stretched. */
  viewBox: string;
}

/** How far below an anchor the path starts or ends, so the stroke clears the text. */
const CLEARANCE = 3;
/** The least drop from the lower anchor to the floor. */
const MIN_DROP = 40;
/** Room around the path for the 5 px stroke, the arrowhead (about 13 px across) and the wobble. */
const PAD = 16;
/** Quarter-circle control-point factor for cubic Béziers. */
const KAPPA = 0.5523;

/**
 * The loop from `from` (below the right end of the stats) to `to` (below
 * "What's next"), dipping to `floor`. Null when there is no room for it: the
 * target is not to the left, the gap is under 40 px deep, or too narrow for
 * the turns and the curl. The caller then draws nothing rather than cross text.
 */
export function loopPath(from: Point, to: Point, floor: number): Loop | null {
  const start = { x: from.x, y: from.y + CLEARANCE };
  const end = { x: to.x, y: to.y + CLEARANCE };
  if (floor - Math.max(from.y, to.y) < MIN_DROP) return null;
  // Turns down-to-left and left-to-up, each a quarter circle.
  const r1 = floor - start.y;
  const r2 = floor - end.y;
  // The curl: a circle of radius r drifting left by `drift` while it turns once.
  const r = Math.min(18, (floor - Math.max(from.y, to.y) - 12) / 2);
  const drift = 2.2 * r;
  const run = start.x - r1 - (end.x + r2);
  if (run < drift + 4 * r) return null;
  const curlStart = end.x + r2 + (run + drift) / 2;

  const segments: [Point, Point, Point][] = [];
  const line = (a: Point, b: Point) =>
    segments.push([
      { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
      { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
      b,
    ]);

  // Down and round to the left.
  segments.push([
    { x: start.x, y: start.y + KAPPA * r1 },
    { x: start.x - r1 + KAPPA * r1, y: floor },
    { x: start.x - r1, y: floor },
  ]);
  line({ x: start.x - r1, y: floor }, { x: curlStart, y: floor });
  // The curl: four quarter arcs of a circle sitting on the floor, turning the
  // same way as the whole arrow, while the pen drifts left. Adding a straight
  // drift to a cubic's points keeps it a cubic.
  const k = KAPPA * r;
  const quarters: [Point, Point, Point][] = [
    [{ x: -k, y: 0 }, { x: -r, y: -r + k }, { x: -r, y: -r }],
    [{ x: -r, y: -r - k }, { x: -k, y: -2 * r }, { x: 0, y: -2 * r }],
    [{ x: k, y: -2 * r }, { x: r, y: -r - k }, { x: r, y: -r }],
    [{ x: r, y: -r + k }, { x: k, y: 0 }, { x: 0, y: 0 }],
  ];
  quarters.forEach((quarter, q) => {
    segments.push(
      quarter.map((point, j) => ({
        x: curlStart + point.x - (drift * (q + (j + 1) / 3)) / 4,
        y: floor + point.y,
      })) as [Point, Point, Point],
    );
  });
  line({ x: curlStart - drift, y: floor }, { x: end.x + r2, y: floor });
  // Round and up to the target.
  segments.push([
    { x: end.x + r2 - KAPPA * r2, y: floor },
    { x: end.x, y: end.y + KAPPA * r2 },
    end,
  ]);

  const f = (n: number) => String(Math.round(n * 100) / 100);
  const p = (point: Point) => `${f(point.x)} ${f(point.y)}`;
  const d = `M ${p(start)} ${segments.map((segment) => `C ${segment.map(p).join(", ")}`).join(" ")}`;

  const all = [start, ...segments.flat()];
  const xs = all.map((point) => point.x);
  const ys = all.map((point) => point.y);
  const x = Math.floor(Math.min(...xs) - PAD);
  const y = Math.floor(Math.min(...ys) - PAD);
  const width = Math.ceil(Math.max(...xs) + PAD) - x;
  const height = Math.ceil(Math.max(...ys) + PAD) - y;
  return { d, box: { x, y, width, height }, viewBox: `${x} ${y} ${width} ${height}` };
}
