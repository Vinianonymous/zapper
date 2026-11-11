import type { CircuitDocument, ResolvedCircuit } from "../model/contracts";
import { onWire, pins, samePoint, segments, segmentsConnect } from "../model/geometry";

export const pinKey = (componentId: string, pin: string): string => `${componentId}:${pin}`;

/** Each wire is continuous. Only endpoints, pins, overlaps or explicit dots merge wires. */
export function resolveCircuit(document: CircuitDocument): ResolvedCircuit {
  const terminals = document.components.flatMap((c) => pins(c).map((p) => ({ ...p, component: c, key: pinKey(c.id, p.name) })));
  const parent = Array.from({ length: terminals.length + document.wires.length }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
    return i;
  };
  const join = (a: number, b: number): void => { parent[find(a)] = find(b); };
  terminals.forEach((p, i) => {
    terminals.slice(0, i).forEach((q, j) => { if (samePoint(p.position, q.position)) join(i, j); });
    document.wires.forEach((wire, j) => { if (onWire(p.position, wire)) join(i, terminals.length + j); });
  });
  const wireSegments = document.wires.map(segments);
  document.wires.forEach((wire, i) => {
    for (let j = 0; j < i; j++) {
      if (wireSegments[i]!.some(([a, b]) => wireSegments[j]!.some(([c, d]) => segmentsConnect(a, b, c, d))) ||
        document.junctions.some((dot) => onWire(dot.position, wire) && onWire(dot.position, document.wires[j]!))) {
        join(terminals.length + i, terminals.length + j);
      }
    }
  });
  // All ground symbols reference the same electrical node even when drawn apart.
  const grounds = terminals.map((p, i) => p.name === "gnd" ? i : -1).filter((i) => i >= 0);
  grounds.slice(1).forEach((i) => join(i, grounds[0]!));
  const groups = new Map<number, string[]>();
  terminals.forEach((pin, i) => { const root = find(i); groups.set(root, [...(groups.get(root) ?? []), pin.key]); });
  const groundRoot = grounds.length ? find(grounds[0]!) : -1;
  const others = [...groups.entries()].filter(([root]) => root !== groundRoot)
    .sort((a, b) => [...a[1]].sort()[0]!.localeCompare([...b[1]].sort()[0]!));
  const nodeByRoot = new Map(others.map(([root], i) => [root, i + 1]));
  nodeByRoot.set(groundRoot, 0);
  const nodeByPin: Record<string, number> = Object.create(null);
  terminals.forEach((pin, i) => { nodeByPin[pin.key] = nodeByRoot.get(find(i))!; });
  return { document, nodeByPin, nodeCount: others.length + 1 };
}
