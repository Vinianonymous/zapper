import type { CircuitDocument, Component, ComponentKind, PinName, Point, Probe, Rotation, Wire } from "../model/contracts";
import { newComponent } from "../model/document";
import { onWire, pins, samePoint, segments, segmentsConnect } from "../model/geometry";

export type Selection =
  | { type: "component"; id: string }
  | { type: "wire"; id: string }
  | { type: "junction"; id: string }
  | null;

export function insertComponent(document: CircuitDocument, kind: ComponentKind, position: Point): Component {
  const component = newComponent(kind, document.components);
  component.position = position;
  document.components.push(component);
  return component;
}

export function removeSelection(document: CircuitDocument, selection: NonNullable<Selection>): void {
  switch (selection.type) {
    case "component":
      {
        const component = document.components.find((item) => item.id === selection.id);
        if (!component) break;
        const terminals = pins(component).map((pin) => pin.position);
        document.wires = document.wires.filter((wire) => !terminals.some((point) => onWire(point, wire)));
        document.junctions = document.junctions.filter((junction) =>
          !terminals.some((point) => samePoint(point, junction.position)));
      }
      document.components = document.components.filter((component) => component.id !== selection.id);
      document.probes = document.probes.filter((probe) =>
        (probe.kind === "current" ? probe.componentId : probe.at.componentId) !== selection.id);
      pruneOrphanWires(document);
      break;
    case "wire":
      document.wires = document.wires.filter((wire) => wire.id !== selection.id);
      pruneOrphanWires(document);
      break;
    case "junction":
      document.junctions = document.junctions.filter((junction) => junction.id !== selection.id);
      break;
  }
}

/** Keep only wires in a connected group that still touches a component pin. */
function pruneOrphanWires(document: CircuitDocument): void {
  const pinPositions = document.components.flatMap((component) => pins(component).map((pin) => pin.position));
  const live = new Set(document.wires.filter((wire) => pinPositions.some((point) => onWire(point, wire))));
  let changed = true;
  while (changed) {
    changed = false;
    for (const wire of document.wires) {
      if (live.has(wire)) continue;
      if (document.wires.some((other) => live.has(other) && segments(wire).some(([a, b]) =>
        segments(other).some(([c, d]) => segmentsConnect(a, b, c, d))))) {
        live.add(wire);
        changed = true;
      }
    }
  }
  document.wires = document.wires.filter((wire) => live.has(wire));
  document.junctions = document.junctions.filter((junction) =>
    document.wires.some((wire) => onWire(junction.position, wire)) ||
    pinPositions.some((point) => samePoint(point, junction.position)));
}

/** Orthogonal, snapped polyline. Shift uses the vertical-first elbow. */
export function routeWire(a: Point, b: Point, verticalFirst = false): Point[] {
  if (samePoint(a, b)) return [];
  if (a.x === b.x || a.y === b.y) return [a, b];
  return verticalFirst ? [a, { x: a.x, y: b.y }, b] : [a, { x: b.x, y: a.y }, b];
}

export function addWire(document: CircuitDocument, a: Point, b: Point, verticalFirst = false): Wire | null {
  const points = routeWire(a, b, verticalFirst);
  if (!points.length) return null;
  const wire = { id: crypto.randomUUID(), points };
  document.wires.push(wire);
  return wire;
}

export function addJunction(document: CircuitDocument, position: Point): boolean {
  if (document.junctions.some((junction) => samePoint(junction.position, position))) return false;
  document.junctions.push({ id: crypto.randomUUID(), position });
  return true;
}

export function rotateComponent(component: Component): void {
  component.rotation = ((component.rotation + 90) % 360) as Rotation;
}

/** Move wire endpoints bonded to a component's pins, leaving the far ends in place. */
function followPins(document: CircuitDocument, before: Component, after: Component): void {
  const oldPins = pins(before);
  const newPins = pins(after);
  for (const wire of document.wires) {
    const first = oldPins.find((pin) => samePoint(pin.position, wire.points[0]!));
    const last = oldPins.find((pin) => samePoint(pin.position, wire.points[wire.points.length - 1]!));
    if (!first && !last) continue;
    const newFirst = first ? newPins.find((pin) => pin.name === first.name)!.position : wire.points[0]!;
    const newLast = last ? newPins.find((pin) => pin.name === last.name)!.position : wire.points[wire.points.length - 1]!;
    if (first && last) {
      // Both ends belong to the part: keep the wire's original shape while translating it.
      const dx = newFirst.x - wire.points[0]!.x, dy = newFirst.y - wire.points[0]!.y;
      wire.points = wire.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      wire.points[wire.points.length - 1] = newLast;
      // Rotation can make the translated last segment diagonal; route the final leg.
      const previous = wire.points[wire.points.length - 2]!;
      wire.points.splice(wire.points.length - 2, 2, ...routeWire(previous, newLast));
    } else if (first) {
      const rest = wire.points.slice(1);
      const lead = routeWire(newFirst, rest[0]!);
      wire.points = [...(lead.length ? lead : [newFirst]), ...rest.slice(1)];
    } else {
      const rest = wire.points.slice(0, -1);
      const lead = routeWire(rest[rest.length - 1]!, newLast);
      wire.points = [...rest.slice(0, -1), ...(lead.length ? lead : [newLast])];
    }
    // A moved pin may land on the next bend. Drop zero-length legs.
    wire.points = wire.points.filter((point, index, points) => index === 0 || !samePoint(point, points[index - 1]!));
    if (wire.points.length < 2) document.wires = document.wires.filter((item) => item !== wire);
  }
}

export function updateComponent(document: CircuitDocument, id: string, change: (component: Component) => void): boolean {
  const component = document.components.find((item) => item.id === id);
  if (!component) return false;
  change(component);
  return true;
}

export function setComponentPosition(document: CircuitDocument, id: string, position: Point): boolean {
  const component = document.components.find((item) => item.id === id);
  if (!component) return false;
  const before = structuredClone(component);
  component.position = position;
  followPins(document, before, component);
  return true;
}

export function rotateComponentInDocument(document: CircuitDocument, id: string): void {
  const component = document.components.find((item) => item.id === id);
  if (!component) return;
  const before = structuredClone(component);
  rotateComponent(component);
  followPins(document, before, component);
}

export function probeKey(probe: Probe): string {
  return probe.kind === "voltage" ? `v:${probe.at.componentId}:${probe.at.pin}` : `i:${probe.componentId}`;
}

export function toggleVoltageProbe(document: CircuitDocument, componentId: string, pin: PinName): boolean {
  const existing = document.probes.find((probe) =>
    probe.kind === "voltage" && probe.at.componentId === componentId && probe.at.pin === pin);
  if (existing) {
    document.probes = document.probes.filter((probe) => probe.id !== existing.id);
    return false;
  }
  document.probes.push({ id: crypto.randomUUID(), kind: "voltage", at: { componentId, pin } });
  return true;
}

export function toggleCurrentProbe(document: CircuitDocument, componentId: string): boolean {
  const existing = document.probes.find((probe) => probe.kind === "current" && probe.componentId === componentId);
  if (existing) {
    document.probes = document.probes.filter((probe) => probe.id !== existing.id);
    return false;
  }
  document.probes.push({ id: crypto.randomUUID(), kind: "current", componentId });
  return true;
}

export function removeProbe(document: CircuitDocument, id: string): void {
  document.probes = document.probes.filter((probe) => probe.id !== id);
}
