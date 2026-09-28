import { test } from "node:test";
import assert from "node:assert/strict";
import { loopPath, type Point } from "./loop-geometry.ts";

type Cubic = [Point, Point, Point, Point];

/** The path as cubic segments. loopPath writes `M x y` then only `C` commands. */
function cubics(d: string): Cubic[] {
  const numbers = (text: string) => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const [, move, rest] = /^M\s*([^C]+)(C[\s\S]*)$/.exec(d.trim()) ?? [];
  assert.ok(move && rest, `unexpected path shape: ${d}`);
  const [mx, my] = numbers(move);
  let current: Point = { x: mx!, y: my! };
  const segments: Cubic[] = [];
  for (const command of rest.split("C").slice(1)) {
    const n = numbers(command);
    assert.equal(n.length, 6, `C takes three points: C${command}`);
    const segment: Cubic = [current, { x: n[0]!, y: n[1]! }, { x: n[2]!, y: n[3]! }, { x: n[4]!, y: n[5]! }];
    segments.push(segment);
    current = segment[3];
  }
  return segments;
}

function at([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return { x: k[0] * p0.x + k[1] * p1.x + k[2] * p2.x + k[3] * p3.x, y: k[0] * p0.y + k[1] * p1.y + k[2] * p2.y + k[3] * p3.y };
}

function samples(d: string): Point[] {
  return cubics(d).flatMap((segment) => Array.from({ length: 41 }, (_, i) => at(segment, i / 40)));
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// The lesson-complete card: stats on the right, "What's next" on the left, both
// sitting on the row's baseline; the loop has the band below them down to `floor`.
const LAYOUTS: { name: string; from: Point; to: Point; floor: number }[] = [
  { name: "the mockup's thread column", from: { x: 600, y: 0 }, to: { x: 70, y: -4 }, floor: 48 },
  { name: "a narrow card", from: { x: 330, y: 2 }, to: { x: 40, y: 0 }, floor: 46 },
  { name: "a wide card", from: { x: 980, y: -10 }, to: { x: 60, y: 0 }, floor: 60 },
];

for (const { name, from, to, floor } of LAYOUTS) {
  test(`${name}: the loop starts and ends within 4 px of its anchors`, () => {
    const loop = loopPath(from, to, floor);
    assert.ok(loop);
    const points = samples(loop.d);
    assert.ok(distance(points[0]!, from) <= 4, `starts at ${JSON.stringify(points[0])}`);
    assert.ok(distance(points.at(-1)!, to) <= 4, `ends at ${JSON.stringify(points.at(-1))}`);
  });

  test(`${name}: the loop stays in the gap: between the anchors across, and between them and the floor down`, () => {
    const loop = loopPath(from, to, floor);
    assert.ok(loop);
    const top = Math.min(from.y, to.y);
    for (const point of samples(loop.d)) {
      assert.ok(point.x >= to.x - 0.5 && point.x <= from.x + 0.5, `x ${point.x} leaves ${to.x}..${from.x}`);
      assert.ok(point.y >= top - 0.5 && point.y <= floor + 0.5, `y ${point.y} leaves ${top}..${floor}`);
    }
  });

  test(`${name}: the loop's last stretch points at the target`, () => {
    const loop = loopPath(from, to, floor);
    assert.ok(loop);
    const last = cubics(loop.d).at(-1)!;
    const end = last[3];
    const tangent = { x: end.x - last[2].x, y: end.y - last[2].y };
    const toTarget = { x: to.x - end.x, y: to.y - end.y };
    const cos = (tangent.x * toTarget.x + tangent.y * toTarget.y) / (Math.hypot(tangent.x, tangent.y) * Math.hypot(toTarget.x, toTarget.y));
    assert.ok(cos > 0.97, `the end heads ${JSON.stringify(tangent)}, the target is ${JSON.stringify(toTarget)} away`);
  });

  test(`${name}: the loop travels at least 40 px down and curls a full turn on the way`, () => {
    const loop = loopPath(from, to, floor);
    assert.ok(loop);
    // Segments share their end points: drop the repeats so every step has a heading.
    const points = samples(loop.d).filter((point, i, all) => i === 0 || distance(point, all[i - 1]!) > 1e-6);
    const ys = points.map((point) => point.y);
    assert.ok(Math.max(...ys) - Math.min(...ys) >= 40, `vertical span ${Math.max(...ys) - Math.min(...ys)}`);
    // Turning: down, round to the left, a full curl, and up again is 180° + 360°.
    let turned = 0;
    for (let i = 2; i < points.length; i++) {
      const a = Math.atan2(points[i - 1]!.y - points[i - 2]!.y, points[i - 1]!.x - points[i - 2]!.x);
      const b = Math.atan2(points[i]!.y - points[i - 1]!.y, points[i]!.x - points[i - 1]!.x);
      turned += Math.atan2(Math.sin(b - a), Math.cos(b - a));
    }
    assert.ok(Math.abs((turned * 180) / Math.PI - 540) < 10, `turned ${(turned * 180) / Math.PI}°`);
  });

  test(`${name}: the view box holds the loop 1:1, with room for the stroke, arrowhead and wobble`, () => {
    const loop = loopPath(from, to, floor);
    assert.ok(loop);
    const { x, y, width, height } = loop.box;
    assert.equal(loop.viewBox, `${x} ${y} ${width} ${height}`);
    for (const point of samples(loop.d)) {
      assert.ok(point.x - x >= 8 && x + width - point.x >= 8, `x ${point.x} is within 8 px of the box edge`);
      assert.ok(point.y - y >= 8 && y + height - point.y >= 8, `y ${point.y} is within 8 px of the box edge`);
    }
  });
}

test("with no room for a loop there is none, rather than one that crosses text", () => {
  assert.equal(loopPath({ x: 150, y: 0 }, { x: 40, y: 0 }, 48), null, "too narrow");
  assert.equal(loopPath({ x: 600, y: 0 }, { x: 70, y: 0 }, 30), null, "too shallow");
  assert.equal(loopPath({ x: 70, y: 0 }, { x: 600, y: 0 }, 48), null, "target on the wrong side");
});
