import type { CircuitDocument, Point, ResolvedCircuit } from "./contracts";
import { key, onSegment, pinPosition, pins } from "./editor";

class Groups {
  private parents = new Map<string, string>();
  add(id: string): void { if (!this.parents.has(id)) this.parents.set(id, id); }
  find(id: string): string {
    const parent = this.parents.get(id);
    if (parent === undefined) throw new Error(`Unknown topology anchor ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parents.set(id, root);
    return root;
  }
  union(a: string, b: string): void {
    const x = this.find(a), y = this.find(b);
    if (x !== y) this.parents.set(y, x);
  }
}

export function resolveTopology(document: CircuitDocument): ResolvedCircuit {
  const groups = new Groups();
  groups.add("ground");
  const positions = new Map<string, Point>();
  const pinKeys: string[] = [];
  const candidates = new Map<string, Point>();
  const segments: { wire: string; a: Point; b: Point }[] = [];
  const addPoint = (point: Point): void => { candidates.set(key(point), point); };

  for (const component of document.components) {
    for (const pin of pins(component)) {
      const id = `${component.id}:${pin}`;
      const point = pinPosition(component, pin);
      groups.add(id);
      positions.set(id, point);
      pinKeys.push(id);
      addPoint(point);
      if (pin === "gnd") groups.union(id, "ground");
    }
  }
  for (const wire of document.wires) {
    const id = `wire:${wire.id}`;
    groups.add(id);
    for (let i = 0; i < wire.points.length; i++) {
      const point = wire.points[i]!;
      addPoint(point);
      if (i) segments.push({ wire: id, a: wire.points[i - 1]!, b: point });
    }
  }
  for (const junction of document.junctions) addPoint(junction.position);

  // Only vertices, pins, and explicit junctions can connect crossing segments.
  // Collinear overlaps always share at least one segment endpoint, so the same rule handles them.
  for (const point of candidates.values()) {
    const incident: string[] = [];
    for (const [id, position] of positions) if (key(position) === key(point)) incident.push(id);
    for (const segment of segments) if (onSegment(point, segment.a, segment.b)) incident.push(segment.wire);
    for (const id of incident.slice(1)) groups.union(incident[0]!, id);
  }

  const groundRoot = groups.find("ground");
  const byRoot = new Map<string, string[]>();
  for (const id of pinKeys) {
    const root = groups.find(id);
    const group = byRoot.get(root) ?? [];
    group.push(id);
    byRoot.set(root, group);
  }
  const roots = [...byRoot.entries()].filter(([root]) => root !== groundRoot)
    .sort((a, b) => a[1]!.sort()[0]!.localeCompare(b[1]!.sort()[0]!));
  const nodeByPin: Record<string, number> = {};
  for (const id of byRoot.get(groundRoot) ?? []) nodeByPin[id] = 0;
  roots.forEach(([, ids], index) => { for (const id of ids) nodeByPin[id] = index + 1; });
  return { document, nodeByPin, nodeCount: roots.length + 1 };
}
