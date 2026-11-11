import type { AnalysisResult, CircuitDocument, Component, Probe, ResolvedCircuit } from "../model/contracts";
import { AnalysisFailure, type Diagnostic } from "../simulation/diagnostics";
import { pinKey } from "../topology/resolve";

export type Complex = { re: number; im: number };
export type AcPointResult = {
  nodeVolts: Complex[];
  branchAmps: Record<string, Complex>;
};
export type AcResult = Extract<AnalysisResult, { kind: "ac" }>;

/** Dense AC sweep limits keep a single synchronous worker run bounded. */
export const AC_LIMITS = { maxUnknowns: 600, maxWork: 250_000_000 };

const zero = (): Complex => ({ re: 0, im: 0 });
const fromPolar = (magnitude: number, phaseDegrees: number): Complex => {
  const radians = phaseDegrees * Math.PI / 180;
  return { re: magnitude * Math.cos(radians), im: magnitude * Math.sin(radians) };
};
const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const subtract = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const multiply = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
const divide = (a: Complex, b: Complex): Complex => {
  const denominator = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  };
};
const magnitude = (value: Complex): number => Math.hypot(value.re, value.im);
const finite = (value: Complex): boolean => Number.isFinite(value.re) && Number.isFinite(value.im);

function fail(code: Diagnostic["code"], message: string, relatedIds: string[] = []): never {
  throw new AnalysisFailure({ code, message, relatedIds });
}

const branchBranch = (component: Component): boolean =>
  component.kind === "voltageSource" || (component.kind === "switch" && component.parameters.closed);

const conductsAtAc = (component: Component): boolean =>
  component.kind === "resistor" || component.kind === "capacitor" || component.kind === "inductor" ||
  component.kind === "voltageSource" || (component.kind === "switch" && component.parameters.closed);

function sourcePhasor(component: Extract<Component, { kind: "voltageSource" | "currentSource" }>): Complex {
  return fromPolar(component.parameters.acMagnitude, component.parameters.acPhaseDegrees);
}

/** Node voltages and signed a → b branch currents for one frequency. */
export function solveAcAt(circuit: ResolvedCircuit, frequencyHz: number): AcPointResult {
  const { document, nodeByPin, nodeCount } = circuit;
  if (!(Number.isFinite(frequencyHz) && frequencyHz > 0)) {
    fail("invalid-input", "AC frequency must be a finite number greater than zero.");
  }
  if (!document.components.some((component) => component.kind === "ground")) {
    fail("missing-ground", "Add and connect a ground reference before running an AC sweep.");
  }
  const elements = document.components.filter((component) => component.kind !== "ground");
  if (elements.length === 0) fail("invalid-input", "Place at least one electrical component, not just ground.");

  const terminals = new Map<number, string[]>();
  for (const component of document.components) {
    for (const pin of component.kind === "ground" ? ["gnd"] : ["a", "b"]) {
      const node = nodeByPin[pinKey(component.id, pin)];
      if (node === undefined || node < 0 || node >= nodeCount) {
        fail("invalid-input", "Circuit topology is invalid. Reconnect the highlighted component.", [component.id]);
      }
      terminals.set(node, [...(terminals.get(node) ?? []), component.id]);
    }
  }
  const nodes = (component: Component): [number, number] => {
    const a = nodeByPin[pinKey(component.id, "a")];
    const b = nodeByPin[pinKey(component.id, "b")];
    if (a === undefined || b === undefined) {
      fail("invalid-input", "Circuit topology is invalid. Reconnect the highlighted component.", [component.id]);
    }
    return [a, b];
  };
  for (const component of elements) {
    for (const [index, node] of nodes(component).entries()) {
      if ((terminals.get(node)?.length ?? 0) < 2) {
        fail(
          "unconnected-pin",
          `${component.ref} pin ${index === 0 ? "a" : "b"} is unconnected. Wire it to another component or ground.`,
          [component.id],
        );
      }
    }
  }

  // At AC, capacitors and inductors provide a signal path even though they do
  // not provide a DC path. Open switches and current sources do not.
  const graph: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const component of elements) {
    if (!conductsAtAc(component)) continue;
    const [a, b] = nodes(component);
    if (a === b) continue;
    graph[a]!.push(b);
    graph[b]!.push(a);
  }
  const visited = new Set([0]);
  const queue = [0];
  for (let i = 0; i < queue.length; i++) {
    for (const next of graph[queue[i]!]!) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  const floating = elements.filter((component) =>
    nodes(component).some((node) => !visited.has(node)));
  if (floating.length) {
    fail(
      "floating-net",
      `No AC signal path to ground near ${floating.map((component) => component.ref).join(", ")}. Connect a resistor, capacitor, inductor or source return to ground; open switches do not provide a path.`,
      floating.map((component) => component.id),
    );
  }

  const branches = elements.filter(branchBranch);
  const constraints: { to: number; delta: Complex; id: string }[][] =
    Array.from({ length: nodeCount }, () => []);
  for (const component of branches) {
    const [a, b] = nodes(component);
    const voltage = component.kind === "voltageSource" ? sourcePhasor(component) : zero();
    constraints[a]!.push({ to: b, delta: { re: -voltage.re, im: -voltage.im }, id: component.id });
    constraints[b]!.push({ to: a, delta: voltage, id: component.id });
  }
  const potential = new Map<number, Complex>();
  for (let root = 0; root < nodeCount; root++) {
    if (potential.has(root)) continue;
    potential.set(root, zero());
    const pending = [root];
    for (let i = 0; i < pending.length; i++) {
      const from = pending[i]!;
      for (const edge of constraints[from]!) {
        const expected = add(potential.get(from)!, edge.delta);
        const current = potential.get(edge.to);
        if (current) {
          const tolerance = 1e-9 * Math.max(1, magnitude(expected), magnitude(current));
          if (magnitude(subtract(current, expected)) > tolerance) {
            fail(
              "contradictory-sources",
              "Ideal voltage sources or closed switches impose conflicting AC voltages. Correct source magnitudes/phases or remove the conflicting short.",
              branches.map((component) => component.id),
            );
          }
        } else {
          potential.set(edge.to, expected);
          pending.push(edge.to);
        }
      }
    }
  }

  const size = nodeCount - 1 + branches.length;
  if (size > AC_LIMITS.maxUnknowns) {
    fail("invalid-input", `AC sweep exceeds the ${AC_LIMITS.maxUnknowns}-unknown limit. Simplify the circuit or run a smaller sweep.`);
  }
  const matrix: Complex[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, zero));
  const rhs: Complex[] = Array.from({ length: size }, zero);
  const stamp = (row: number, col: number, value: Complex): void => {
    if (row < 0 || col < 0) return;
    matrix[row]![col] = add(matrix[row]![col]!, value);
  };
  const stampAdmittance = (a: number, b: number, value: Complex): void => {
    const ai = a - 1, bi = b - 1;
    const negative = { re: -value.re, im: -value.im };
    stamp(ai, ai, value); stamp(bi, bi, value);
    stamp(ai, bi, negative); stamp(bi, ai, negative);
  };
  const inject = (node: number, value: Complex): void => {
    if (node <= 0) return;
    rhs[node - 1] = add(rhs[node - 1]!, value);
  };
  const branchIndex = new Map(branches.map((component, index) => [component.id, nodeCount - 1 + index]));
  const omega = 2 * Math.PI * frequencyHz;

  for (const component of elements) {
    const [a, b] = nodes(component);
    if (component.kind === "resistor") {
      stampAdmittance(a, b, { re: 1 / component.parameters.ohms, im: 0 });
    } else if (component.kind === "capacitor") {
      const susceptance = omega * component.parameters.farads;
      if (!Number.isFinite(susceptance)) fail("ill-conditioned", "Capacitance and frequency produce an unusable admittance.", [component.id]);
      stampAdmittance(a, b, { re: 0, im: susceptance });
    } else if (component.kind === "inductor") {
      const reactance = omega * component.parameters.henrys;
      if (!(reactance > 0) || !Number.isFinite(reactance)) {
        fail("ill-conditioned", "Inductance and frequency produce an unusable reactance. Raise the start frequency or use a larger inductance.", [component.id]);
      }
      stampAdmittance(a, b, { re: 0, im: -1 / reactance });
    } else if (component.kind === "currentSource") {
      const current = sourcePhasor(component);
      inject(a, { re: -current.re, im: -current.im });
      inject(b, current);
    } else if (branchBranch(component)) {
      const branch = branchIndex.get(component.id)!;
      const one = { re: 1, im: 0 };
      const negativeOne = { re: -1, im: 0 };
      stamp(a - 1, branch, one); stamp(b - 1, branch, negativeOne);
      stamp(branch, a - 1, one); stamp(branch, b - 1, negativeOne);
      rhs[branch] = component.kind === "voltageSource" ? sourcePhasor(component) : zero();
    }
  }

  const solution = solveComplexLinear(matrix, rhs, branches.map((component) => component.id));
  const nodeVolts: Complex[] = [zero(), ...solution.slice(0, nodeCount - 1)];
  const branchAmps: Record<string, Complex> = Object.create(null);
  for (const component of elements) {
    const [a, b] = nodes(component);
    const difference = subtract(nodeVolts[a]!, nodeVolts[b]!);
    let current = zero();
    if (component.kind === "resistor") {
      current = { re: difference.re / component.parameters.ohms, im: difference.im / component.parameters.ohms };
    } else if (component.kind === "capacitor") {
      const scale = omega * component.parameters.farads;
      current = { re: -difference.im * scale, im: difference.re * scale };
    } else if (component.kind === "inductor") {
      const scale = 1 / (omega * component.parameters.henrys);
      current = { re: difference.im * scale, im: -difference.re * scale };
    } else if (component.kind === "currentSource") {
      current = sourcePhasor(component);
    } else if (branchBranch(component)) {
      current = solution[branchIndex.get(component.id)!]!;
    }
    if (!finite(current)) {
      fail("ill-conditioned", "Computed current is not finite. Reduce extreme component values.", [component.id]);
    }
    branchAmps[component.id] = current;
  }
  return { nodeVolts, branchAmps };
}

function solveComplexLinear(matrix: Complex[][], rhs: Complex[], branchIds: string[]): Complex[] {
  const n = rhs.length;
  const a = matrix.map((row) => row.map((value) => ({ ...value })));
  const b = rhs.map((value) => ({ ...value }));
  const scales = a.map((row) => Math.max(0, ...row.map(magnitude)));
  for (let row = 0; row < n; row++) {
    if (!(scales[row]! > 0) || !Number.isFinite(scales[row]!)) {
      fail("singular-matrix", "A node or ideal branch has no independent AC equation. Remove redundant ideal-source/short loops.", branchIds);
    }
    const scale = { re: scales[row]!, im: 0 };
    for (let col = 0; col < n; col++) a[row]![col] = divide(a[row]![col]!, scale);
    b[row] = divide(b[row]!, scale);
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (magnitude(a[row]![col]!) > magnitude(a[pivot]![col]!)) pivot = row;
    }
    const pivotMagnitude = magnitude(a[pivot]![col]!);
    if (!Number.isFinite(pivotMagnitude)) {
      fail("ill-conditioned", "The AC matrix contains a non-finite pivot. Reduce extreme component values.", branchIds);
    }
    if (pivotMagnitude < 1e-15) {
      fail("singular-matrix", "The AC circuit has dependent ideal constraints. Remove parallel ideal sources or loops of closed switches, or add resistance.", branchIds);
    }
    if (pivotMagnitude < 1e-12) {
      fail("ill-conditioned", "The AC matrix is poorly conditioned. Reduce extreme resistance/reactance ratios.", branchIds);
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    for (let row = col + 1; row < n; row++) {
      const factor = divide(a[row]![col]!, a[col]![col]!);
      if (factor.re === 0 && factor.im === 0) continue;
      a[row]![col] = zero();
      for (let k = col + 1; k < n; k++) {
        a[row]![k] = subtract(a[row]![k]!, multiply(factor, a[col]![k]!));
      }
      b[row] = subtract(b[row]!, multiply(factor, b[col]!));
    }
  }
  const solution: Complex[] = Array.from({ length: n }, zero);
  for (let row = n - 1; row >= 0; row--) {
    let value = b[row]!;
    for (let col = row + 1; col < n; col++) value = subtract(value, multiply(a[row]![col]!, solution[col]!));
    solution[row] = divide(value, a[row]![row]!);
    if (!finite(solution[row]!)) {
      fail("ill-conditioned", "The AC solver produced a non-finite value. Check component values and ideal constraints.", branchIds);
    }
  }
  for (let row = 0; row < n; row++) {
    let actual = zero();
    let scale = magnitude(rhs[row]!);
    for (let col = 0; col < n; col++) {
      const product = multiply(matrix[row]![col]!, solution[col]!);
      actual = add(actual, product);
      scale += magnitude(product);
    }
    if (magnitude(subtract(actual, rhs[row]!)) > 1e-9 * Math.max(scale, 1e-12)) {
      fail("ill-conditioned", "The AC solver could not verify the solution residual. Reduce extreme values.", branchIds);
    }
  }
  return solution;
}

/** Complex value measured by a probe. Missing anchors are a validation error, never a fake zero. */
export function probeComplex(probe: Probe, circuit: ResolvedCircuit, point: AcPointResult): Complex | undefined {
  if (probe.kind === "voltage") {
    const node = circuit.nodeByPin[pinKey(probe.at.componentId, probe.at.pin)];
    return node === undefined ? undefined : point.nodeVolts[node];
  }
  return point.branchAmps[probe.componentId];
}

/**
 * Logarithmic AC sweep. Every frequency is solved independently on the same
 * resolved snapshot, then probe phasors are converted to magnitude/phase.
 */
export function sweepAc(circuit: ResolvedCircuit, settings: CircuitDocument["settings"]["ac"]): AcResult {
  const { startHz, stopHz, points } = settings;
  if (!(Number.isFinite(startHz) && startHz > 0) ||
    !(Number.isFinite(stopHz) && stopHz > startHz) ||
    !Number.isInteger(points) || points < 2 || points > 10_000) {
    fail("invalid-input", "AC sweep needs a positive start frequency, a greater stop frequency and an integer point count from 2 to 10000.");
  }
  const elements = circuit.document.components.filter((component) => component.kind !== "ground");
  const unknowns = circuit.nodeCount - 1 + elements.filter(branchBranch).length;
  if (unknowns > AC_LIMITS.maxUnknowns) {
    fail("invalid-input", `AC sweep exceeds the ${AC_LIMITS.maxUnknowns}-unknown limit. Simplify the circuit or reduce its size.`);
  }
  if (unknowns ** 3 * points > AC_LIMITS.maxWork) {
    fail(
      "invalid-input",
      `AC sweep is too large (${points} points on ${unknowns} unknowns). Reduce the point count or circuit size.`,
    );
  }

  const frequenciesHz = Array.from({ length: points }, (_, index) =>
    index === points - 1 ? stopHz : startHz * Math.pow(stopHz / startHz, index / (points - 1)));
  const probes: Record<string, { magnitude: number[]; phaseDegrees: number[] }> = Object.create(null);
  for (const probe of circuit.document.probes) {
    probes[probe.id] = { magnitude: [], phaseDegrees: [] };
  }

  for (const frequency of frequenciesHz) {
    let point: AcPointResult;
    try {
      point = solveAcAt(circuit, frequency);
    } catch (error) {
      if (error instanceof AnalysisFailure) {
        throw new AnalysisFailure({
          ...error.diagnostic,
          message: `${error.diagnostic.message} (at ${frequency.toPrecision(6)} Hz)`,
        });
      }
      throw error;
    }
    for (const probe of circuit.document.probes) {
      const value = probeComplex(probe, circuit, point);
      const related = probe.kind === "current" ? [probe.componentId] : [probe.at.componentId];
      if (!value || !finite(value)) {
        fail("invalid-input", "A probe points to a missing or unavailable node. Remove and replace the probe.", related);
      }
      const probeMagnitude = magnitude(value);
      const probePhase = Math.atan2(value.im, value.re) * 180 / Math.PI;
      if (!Number.isFinite(probeMagnitude) || !Number.isFinite(probePhase)) {
        fail("ill-conditioned", "A probe produced a non-finite AC reading. Reduce extreme component values.", related);
      }
      probes[probe.id]!.magnitude.push(probeMagnitude);
      probes[probe.id]!.phaseDegrees.push(probePhase === 0 ? 0 : probePhase);
    }
  }
  return { kind: "ac", frequenciesHz, probes };
}
