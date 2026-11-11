import type { CircuitDocument, Component, ComponentKind, PinName, Point, Probe, Rotation, Wire } from "../model/contracts";
import { newComponent } from "../model/document";
import { samePoint } from "../model/geometry";

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
      document.components = document.components.filter((component) => component.id !== selection.id);
      document.probes = document.probes.filter((probe) =>
        (probe.kind === "current" ? probe.componentId : probe.at.componentId) !== selection.id);
      break;
    case "wire":
      document.wires = document.wires.filter((wire) => wire.id !== selection.id);
      break;
    case "junction":
      document.junctions = document.junctions.filter((junction) => junction.id !== selection.id);
      break;
  }
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

export function updateComponent(document: CircuitDocument, id: string, change: (component: Component) => void): boolean {
  const component = document.components.find((item) => item.id === id);
  if (!component) return false;
  change(component);
  return true;
}

export function setComponentPosition(document: CircuitDocument, id: string, position: Point): boolean {
  return updateComponent(document, id, (component) => { component.position = position; });
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
