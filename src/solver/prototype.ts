/** Phase 0 numerical spike: nets are already numbered; 0 is ground. */
export type Element =
  | { kind: "resistor"; a: number; b: number; ohms: number }
  | { kind: "capacitor"; a: number; b: number; farads: number }
  | { kind: "voltageSource"; a: number; b: number; dcVolts: number; acVolts?: { real: number; imaginary: number } };

export type PrototypeCircuit = { nodeCount: number; elements: Element[] };
export type Complex = { real: number; imaginary: number };
export type PrototypeResult = { nodeVolts: Complex[]; sourceAmps: Complex[] };

const ABSOLUTE_PIVOT = 1e-14;
const RELATIVE_PIVOT = 1e-12;

function validate(circuit: PrototypeCircuit): void {
  if (!Number.isSafeInteger(circuit.nodeCount) || circuit.nodeCount < 2 || circuit.nodeCount > 500) {
    throw new Error("nodeCount must be between 2 and 500, including ground");
  }
  if (circuit.elements.length > 1000) throw new Error("Too many elements for prototype");
  for (const element of circuit.elements) {
    for (const node of [element.a, element.b]) {
      if (!Number.isSafeInteger(node) || node < 0 || node >= circuit.nodeCount) {
        throw new Error("Element node is out of range");
      }
    }
    if (element.a === element.b) throw new Error("Element has both pins on the same net");
    if (element.kind === "resistor" && !(Number.isFinite(element.ohms) && element.ohms > 0)) {
      throw new Error("Resistance must be finite and positive");
    }
    if (element.kind === "capacitor" && !(Number.isFinite(element.farads) && element.farads > 0)) {
      throw new Error("Capacitance must be finite and positive");
    }
    if (element.kind === "voltageSource" &&
      (!Number.isFinite(element.dcVolts) ||
        (element.acVolts !== undefined &&
          (!Number.isFinite(element.acVolts.real) || !Number.isFinite(element.acVolts.imaginary))))) {
      throw new Error("Source value must be finite");
    }
  }
}

/** Partial pivoting. The absolute threshold is provisional; see docs/architecture.md. */
function solveReal(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row) => [...row]);
  const b = [...rhs];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    const scale = Math.max(...a[pivot]!.slice(col).map(Math.abs));
    if (!Number.isFinite(scale) || Math.abs(a[pivot]![col]!) <= Math.max(ABSOLUTE_PIVOT, RELATIVE_PIVOT * scale)) {
      throw new Error("Singular or poorly scaled circuit matrix");
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row]![col]! / a[col]![col]!;
      for (let k = col + 1; k < n; k++) a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
      a[row]![col] = 0;
      b[row] = b[row]! - factor * b[col]!;
    }
  }
  const result = Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let value = b[row]!;
    for (let col = row + 1; col < n; col++) value -= a[row]![col]! * result[col]!;
    result[row] = value / a[row]![row]!;
    if (!Number.isFinite(result[row])) throw new Error("Non-finite circuit result");
  }
  return result;
}

function solve(circuit: PrototypeCircuit, frequencyHz?: number): PrototypeResult {
  validate(circuit);
  if (frequencyHz !== undefined && !(Number.isFinite(frequencyHz) && frequencyHz > 0)) {
    throw new Error("AC frequency must be finite and positive");
  }
  const ac = frequencyHz !== undefined;
  const voltageSources = circuit.elements.filter((element) => element.kind === "voltageSource");
  const size = circuit.nodeCount - 1 + voltageSources.length;
  const width = ac ? size * 2 : size;
  const matrix = Array.from({ length: width }, () => Array<number>(width).fill(0));
  const rhs = Array<number>(width).fill(0);
  const index = (node: number): number => node - 1;

  function stamp(row: number, col: number, real: number, imaginary = 0): void {
    if (row < 0 || col < 0) return; // Ground has no matrix row.
    matrix[row]![col] = matrix[row]![col]! + real;
    if (ac) {
      matrix[row]![col + size] = matrix[row]![col + size]! - imaginary;
      matrix[row + size]![col] = matrix[row + size]![col]! + imaginary;
      matrix[row + size]![col + size] = matrix[row + size]![col + size]! + real;
    }
  }

  function stampAdmittance(a: number, b: number, real: number, imaginary = 0): void {
    stamp(index(a), index(a), real, imaginary);
    stamp(index(b), index(b), real, imaginary);
    stamp(index(a), index(b), -real, -imaginary);
    stamp(index(b), index(a), -real, -imaginary);
  }

  let sourceIndex = 0;
  for (const element of circuit.elements) {
    if (element.kind === "resistor") {
      stampAdmittance(element.a, element.b, 1 / element.ohms);
    } else if (element.kind === "capacitor") {
      if (ac) stampAdmittance(element.a, element.b, 0, 2 * Math.PI * frequencyHz * element.farads);
    } else {
      const branch = circuit.nodeCount - 1 + sourceIndex++;
      stamp(index(element.a), branch, 1);
      stamp(index(element.b), branch, -1);
      stamp(branch, index(element.a), 1);
      stamp(branch, index(element.b), -1);
      rhs[branch] = ac ? (element.acVolts?.real ?? 0) : element.dcVolts;
      if (ac) rhs[branch + size] = element.acVolts?.imaginary ?? 0;
    }
  }

  const solution = solveReal(matrix, rhs);
  const at = (position: number): Complex => ({
    real: solution[position]!, imaginary: ac ? solution[position + size]! : 0,
  });
  return {
    nodeVolts: [{ real: 0, imaginary: 0 }, ...Array.from({ length: circuit.nodeCount - 1 }, (_, i) => at(i))],
    sourceAmps: voltageSources.map((_, i) => at(circuit.nodeCount - 1 + i)),
  };
}

export function solveDC(circuit: PrototypeCircuit): PrototypeResult {
  return solve(circuit);
}

export function solveAC(circuit: PrototypeCircuit, frequencyHz: number): PrototypeResult {
  return solve(circuit, frequencyHz);
}
