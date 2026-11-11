import type { AnalysisResult, ResolvedCircuit } from "../model/contracts";
import type { AnalysisErrorCode, Component } from "../model/contracts";
import { AnalysisFailure } from "../simulation/diagnostics";
import { pinKey } from "../topology/resolve";

export type DcResult = Extract<AnalysisResult, { kind: "dc" }>;

function fail(code: AnalysisErrorCode, message: string, relatedIds: string[] = []): never {
  throw new AnalysisFailure({ code, message, relatedIds });
}

const constrained = (c: Component): boolean => c.kind === "voltageSource" || c.kind === "inductor" || (c.kind === "switch" && c.parameters.closed);

/** Dense real MNA. Open switches are exact opens; closed switches are ideal zero-volt branches. */
export function solveDc(circuit: ResolvedCircuit): DcResult {
  const { document, nodeByPin, nodeCount } = circuit;
  if (!document.components.some((c) => c.kind === "ground")) fail("missing-ground", "Add and connect a ground reference.");
  const elements = document.components.filter((c) => c.kind !== "ground");
  if (elements.length === 0) fail("invalid-input", "Place at least one electrical component, not just ground.");
  const nodes = (c: Component): [number, number] => [nodeByPin[pinKey(c.id, "a")]!, nodeByPin[pinKey(c.id, "b")]!];
  const terminals = new Map<number, string[]>();
  for (const c of document.components) {
    for (const pin of c.kind === "ground" ? ["gnd"] : ["a", "b"]) {
      const node = nodeByPin[pinKey(c.id, pin)];
      if (node === undefined || node < 0 || node >= nodeCount) fail("invalid-input", "Circuit topology is invalid. Reconnect the highlighted component.", [c.id]);
      terminals.set(node, [...(terminals.get(node) ?? []), c.id]);
    }
  }
  for (const c of elements) {
    for (const [i, node] of nodes(c).entries()) {
      if ((terminals.get(node)?.length ?? 0) < 2) fail("unconnected-pin", `${c.ref} pin ${i === 0 ? "a" : "b"} is unconnected. Wire it to another component or ground.`, [c.id]);
    }
  }
  const graph: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const c of elements) {
    const [a, b] = nodes(c);
    if (c.kind === "resistor" || constrained(c)) { graph[a]!.push(b); graph[b]!.push(a); }
  }
  const visited = new Set([0]); const queue = [0];
  for (let i = 0; i < queue.length; i++) for (const next of graph[queue[i]!]!) if (!visited.has(next)) { visited.add(next); queue.push(next); }
  const floating = elements.filter((c) => nodes(c).some((n) => !visited.has(n)));
  if (floating.length) fail("floating-net", `No DC path to ground near ${floating.map((c) => c.ref).join(", ")}. Connect a resistor or source return to ground; capacitors and open switches do not provide a DC path.`, floating.map((c) => c.id));

  const branches = elements.filter(constrained);
  // Check ideal voltage constraints independently, so contradictory sources do not
  // appear as an opaque singular matrix error. Consistent redundant loops still fail MNA.
  const constraints: { to: number; delta: number; id: string }[][] = Array.from({ length: nodeCount }, () => []);
  for (const c of branches) {
    const [a, b] = nodes(c); const voltage = c.kind === "voltageSource" ? c.parameters.dc : 0;
    constraints[a]!.push({ to: b, delta: -voltage, id: c.id });
    constraints[b]!.push({ to: a, delta: voltage, id: c.id });
  }
  const potential = new Map<number, number>();
  for (let root = 0; root < nodeCount; root++) {
    if (potential.has(root)) continue;
    potential.set(root, 0); const pending = [root];
    for (let i = 0; i < pending.length; i++) {
      const from = pending[i]!;
      for (const edge of constraints[from]!) {
        const expected = potential.get(from)! + edge.delta;
        if (potential.has(edge.to)) {
          if (Math.abs(potential.get(edge.to)! - expected) > 1e-9 * Math.max(1, Math.abs(expected), Math.abs(potential.get(edge.to)!))) {
            fail("contradictory-sources", "Ideal voltage sources, inductors or closed switches impose conflicting voltages. Correct source values or remove the conflicting short.", branches.map((c) => c.id));
          }
        } else { potential.set(edge.to, expected); pending.push(edge.to); }
      }
    }
  }
  const size = nodeCount - 1 + branches.length;
  if (size > 800) fail("invalid-input", "Circuit exceeds the DC matrix limit (800 unknowns).");
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const rhs = Array<number>(size).fill(0);
  const stamp = (row: number, col: number, value: number): void => { if (row >= 0 && col >= 0) matrix[row]![col] = matrix[row]![col]! + value; };
  const inject = (node: number, value: number): void => { if (node > 0) rhs[node - 1] = rhs[node - 1]! + value; };
  const branchIndex = new Map(branches.map((c, i) => [c.id, nodeCount - 1 + i]));
  for (const c of elements) {
    const [a, b] = nodes(c); const ai = a - 1, bi = b - 1;
    if (c.kind === "resistor") {
      const g = 1 / c.parameters.ohms;
      stamp(ai, ai, g); stamp(bi, bi, g); stamp(ai, bi, -g); stamp(bi, ai, -g);
    } else if (c.kind === "currentSource") {
      inject(a, -c.parameters.dc); inject(b, c.parameters.dc);
    } else if (constrained(c)) {
      const branch = branchIndex.get(c.id)!;
      stamp(ai, branch, 1); stamp(bi, branch, -1); stamp(branch, ai, 1); stamp(branch, bi, -1);
      rhs[branch] = c.kind === "voltageSource" ? c.parameters.dc : 0;
    }
  }
  const solution = solveLinear(matrix, rhs, branches.map((c) => c.id));
  const nodeVolts = [0, ...solution.slice(0, nodeCount - 1)];
  const branchAmps: Record<string, number> = Object.create(null);
  for (const c of elements) {
    const [a, b] = nodes(c);
    let current = 0;
    if (c.kind === "resistor") current = (nodeVolts[a]! - nodeVolts[b]!) / c.parameters.ohms;
    else if (c.kind === "currentSource") current = c.parameters.dc;
    else if (constrained(c)) current = solution[branchIndex.get(c.id)!]!;
    if (!Number.isFinite(current)) fail("ill-conditioned", "Computed current is not finite. Reduce extreme component values.", [c.id]);
    branchAmps[c.id] = current;
  }
  return { kind: "dc", nodeVolts, branchAmps };
}

export function solveLinear(matrix: number[][], rhs: number[], branchIds: string[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row) => [...row]); const b = [...rhs];
  // Row equilibration makes mixed current/voltage MNA equations less scale-sensitive.
  const scales = a.map((row) => Math.max(...row.map(Math.abs)));
  for (let row = 0; row < n; row++) {
    if (!scales[row]) fail("singular-matrix", "A node or ideal branch has no independent equation. Remove redundant ideal-source/short loops.", branchIds);
    for (let col = 0; col < n; col++) a[row]![col] = a[row]![col]! / scales[row]!;
    b[row] = b[row]! / scales[row]!;
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    const magnitude = Math.abs(a[pivot]![col]!);
    if (magnitude < 1e-15) fail("singular-matrix", "The circuit has dependent ideal constraints. Remove parallel ideal sources or loops of inductors/closed switches, or add resistance.", branchIds);
    if (!Number.isFinite(magnitude) || magnitude < 1e-12) fail("ill-conditioned", "The circuit matrix is poorly conditioned. Reduce extreme resistance ratios or add realistic series resistance.", branchIds);
    [a[col], a[pivot]] = [a[pivot]!, a[col]!]; [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row]![col]! / a[col]![col]!;
      if (factor === 0) continue;
      a[row]![col] = 0;
      for (let k = col + 1; k < n; k++) a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
      b[row] = b[row]! - factor * b[col]!;
    }
  }
  const x = Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let value = b[row]!;
    for (let col = row + 1; col < n; col++) value -= a[row]![col]! * x[col]!;
    x[row] = value / a[row]![row]!;
    if (!Number.isFinite(x[row])) fail("ill-conditioned", "The solver produced a non-finite value. Check component values and ideal constraints.", branchIds);
  }
  for (let row = 0; row < n; row++) {
    let actual = 0, scale = Math.abs(rhs[row]!);
    for (let col = 0; col < n; col++) { actual += matrix[row]![col]! * x[col]!; scale += Math.abs(matrix[row]![col]! * x[col]!); }
    if (Math.abs(actual - rhs[row]!) > 1e-9 * Math.max(scale, 1e-12)) fail("ill-conditioned", "The solver could not verify the solution residual. Reduce extreme values.", branchIds);
  }
  return x;
}
