import type { CircuitDocument, Component, ComponentKind, PinName, Point, Rotation, Wire } from "./contracts";

export const GRID = 24;
export const PIN_OFFSET = 2;
export const defaults = { ac: { startHz: 10, stopHz: 100000, points: 100 }, transient: { durationSeconds: 0.1, stepSeconds: 0.0001 } };
export const blank = (): CircuitDocument => ({ schemaVersion: 1, components: [], wires: [], junctions: [], probes: [], settings: structuredClone(defaults) });

export function pinPosition(component: Component, pin: PinName): Point {
  if (component.kind === "ground") {
    if (pin !== "gnd") throw new Error("Invalid ground pin");
    return { ...component.position };
  }
  if (pin === "gnd") throw new Error("Invalid two-terminal pin");
  const x = pin === "a" ? -PIN_OFFSET : PIN_OFFSET;
  const { position: p, rotation } = component;
  return rotation === 0 ? { x: p.x + x, y: p.y }
    : rotation === 90 ? { x: p.x, y: p.y + x }
    : rotation === 180 ? { x: p.x - x, y: p.y }
    : { x: p.x, y: p.y - x };
}

export function pins(component: Component): PinName[] {
  return component.kind === "ground" ? ["gnd"] : ["a", "b"];
}

export const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
export const key = (p: Point): string => `${p.x},${p.y}`;
export const onSegment = (p: Point, a: Point, b: Point): boolean =>
  (a.x === b.x && p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) ||
  (a.y === b.y && p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));

export function nextRef(document: CircuitDocument, kind: ComponentKind): string {
  const prefix: Record<ComponentKind, string> = { resistor: "R", variableResistor: "VR", lamp: "B", capacitor: "C", inductor: "L", voltageSource: "V", currentSource: "I", switch: "S", ground: "GND" };
  const used = new Set(document.components.map((c) => c.ref));
  let i = 1;
  while (used.has(`${prefix[kind]}${i}`)) i++;
  return `${prefix[kind]}${i}`;
}

export function createComponent(kind: ComponentKind, position: Point, ref: string, id: string = crypto.randomUUID()): Component {
  const base = { id, ref, position, rotation: 0 as Rotation };
  switch (kind) {
    case "resistor": return { ...base, kind, parameters: { ohms: 1000 } };
    case "variableResistor": return { ...base, kind, parameters: { ohms: 1000 } };
    case "lamp": return { ...base, kind, parameters: { ohms: 100 } };
    case "capacitor": return { ...base, kind, parameters: { farads: 1e-6 } };
    case "inductor": return { ...base, kind, parameters: { henrys: 1e-3 } };
    case "switch": return { ...base, kind, parameters: { closed: false } };
    case "ground": return { ...base, kind, parameters: {} };
    default: return { ...base, kind, parameters: { dc: kind === "voltageSource" ? 10 : 0, acMagnitude: 0, acPhaseDegrees: 0, transient: { kind: "dc" } } };
  }
}

export function rotate(rotation: Rotation): Rotation { return ((rotation + 90) % 360) as Rotation; }

/** A single elbow, horizontal first. If already aligned, use one segment. */
export function route(a: Point, b: Point): Point[] {
  if (same(a, b)) return [];
  return a.x === b.x || a.y === b.y ? [a, b] : [a, { x: b.x, y: a.y }, b];
}

/** Moving an endpoint-attached pin reroutes its wire instead of silently breaking it. */
export function moveComponent(document: CircuitDocument, id: string, position: Point): { detached: boolean } {
  const component = document.components.find((c) => c.id === id);
  if (!component) return { detached: false };
  const oldPins = pins(component).map((pin) => pinPosition(component, pin));
  const oldEndpoints = new Set(oldPins.map(key));
  const attachedEndpoints = new Set(document.wires.flatMap((wire) => [wire.points[0], wire.points.at(-1)].filter((p): p is Point => !!p).map(key)));
  const detached = oldPins.some((point) => !attachedEndpoints.has(key(point)) && document.wires.some((wire) => wire.points.slice(0, -1).some((p, i) => onSegment(point, p, wire.points[i + 1]!))));
  component.position = position;
  const newPins = pins(component).map((pin) => pinPosition(component, pin));
  const relocated = new Map(oldPins.map((point, i) => [key(point), newPins[i]!]));
  for (const wire of document.wires) {
    const first = wire.points[0]!;
    const last = wire.points.at(-1)!;
    const start = relocated.get(key(first));
    const end = relocated.get(key(last));
    if (!start && !end) continue;
    const points = [...wire.points];
    if (start) points[0] = start;
    if (end) points[points.length - 1] = end;
    // Recreate the adjacent section(s) if a moved endpoint makes it diagonal.
    const clean: Point[] = [points[0]!];
    for (const point of points.slice(1)) {
      const previous = clean.at(-1)!;
      if (same(previous, point)) continue;
      if (previous.x !== point.x && previous.y !== point.y) clean.push({ x: point.x, y: previous.y });
      clean.push(point);
    }
    if (clean.length >= 2) wire.points = clean;
  }
  return { detached };
}

export function removeSelection(document: CircuitDocument, type: "component" | "wire" | "junction", id: string): void {
  if (type === "component") {
    document.components = document.components.filter((c) => c.id !== id);
    document.probes = document.probes.filter((p) => (p.kind === "current" ? p.componentId : p.at.componentId) !== id);
  } else if (type === "wire") document.wires = document.wires.filter((w) => w.id !== id);
  else document.junctions = document.junctions.filter((j) => j.id !== id);
}

export function makeWire(start: Point, end: Point): Wire | null {
  const points = route(start, end);
  return points.length ? { id: crypto.randomUUID(), points } : null;
}

export function voltageDivider(): CircuitDocument {
  const document = blank();
  document.components = [
    { ...createComponent("voltageSource", { x: 0, y: 4 }, "V1", "source"), rotation: 90 },
    createComponent("resistor", { x: 6, y: 2 }, "R1", "upper"),
    { ...createComponent("resistor", { x: 10, y: 6 }, "R2", "lower"), rotation: 90 },
    createComponent("ground", { x: 0, y: 10 }, "GND1", "ground1"),
    createComponent("ground", { x: 10, y: 10 }, "GND2", "ground2"),
  ];
  const ends: [Point, Point][] = [
    [{ x: 0, y: 2 }, { x: 4, y: 2 }],
    [{ x: 8, y: 2 }, { x: 10, y: 2 }],
    [{ x: 10, y: 2 }, { x: 10, y: 4 }],
    [{ x: 10, y: 8 }, { x: 10, y: 10 }],
    [{ x: 0, y: 6 }, { x: 0, y: 10 }],
  ];
  document.wires = ends.map(([a, b], i) => ({ id: `wire${i}`, points: [a, b] }));
  return document;
}
