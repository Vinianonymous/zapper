import type { Component, PinName, Point, Wire } from "./contracts";

export const GRID = 20;
export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
export const pointKey = (p: Point): string => `${p.x},${p.y}`;

export function pins(component: Component): { name: PinName; position: Point }[] {
  if (component.kind === "ground") return [{ name: "gnd", position: component.position }];
  return (["a", "b"] as const).map((name) => {
    const x = name === "a" ? -2 : 2;
    const offsets: Record<number, Point> = { 0: { x, y: 0 }, 90: { x: 0, y: x }, 180: { x: -x, y: 0 }, 270: { x: 0, y: -x } };
    const offset = offsets[component.rotation]!;
    return { name, position: { x: component.position.x + offset.x, y: component.position.y + offset.y } };
  });
}

export function onSegment(p: Point, a: Point, b: Point): boolean {
  return (a.x === b.x && p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) ||
    (a.y === b.y && p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
}

export function segments(wire: Wire): [Point, Point][] {
  return wire.points.slice(1).map((point, i) => [wire.points[i]!, point]);
}

export function onWire(point: Point, wire: Wire): boolean {
  return segments(wire).some(([a, b]) => onSegment(point, a, b));
}

/** Endpoints (including polyline bends) connect; two interiors alone do not. */
export function segmentsConnect(a: Point, b: Point, c: Point, d: Point): boolean {
  if (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) return true;
  // A collinear positive-length overlap is one electrical wire. Perpendicular
  // crossings in their interiors still require an explicit junction.
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
  }
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  }
  return false;
}
