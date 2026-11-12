import type { AnalysisResult, ResolvedCircuit, SourceParameters } from "../model/contracts";
import { AnalysisFailure } from "../simulation/diagnostics";
import { pinKey } from "../topology/resolve";
import { solveDc, solveLinear, type DcResult } from "./dc";

export type TransientResult = Extract<AnalysisResult, { kind: "transient" }>;
export const TRANSIENT_LIMITS = { steps: 100_000, unknowns: 600, work: 250_000_000, samples: 2_000_000 };

/** Pulse width is the high plateau, excluding rise and fall. */
export function sourceAt(source: SourceParameters, time: number): number {
  const wave = source.transient;
  if (wave.kind === "dc") return source.dc;
  if (wave.kind === "sine") return wave.offset + wave.amplitude * Math.sin(2 * Math.PI * wave.frequency * time + wave.phaseDegrees * Math.PI / 180);
  if (time < wave.delay) return wave.low;
  const phase = (time - wave.delay) % wave.period;
  if (phase < wave.rise) return wave.low + (wave.high - wave.low) * phase / wave.rise;
  if (phase < wave.rise + wave.width) return wave.high;
  if (phase < wave.rise + wave.width + wave.fall) return wave.high + (wave.low - wave.high) * (phase - wave.rise - wave.width) / wave.fall;
  return wave.low;
}

/** Backward Euler companion models, initialized only from a valid DC solve. */
export function simulateTransient(circuit: ResolvedCircuit): TransientResult {
  const { document, nodeCount, nodeByPin } = circuit;
  const { durationSeconds: duration, stepSeconds: step } = document.settings.transient;
  const count = Math.ceil(duration / step);
  const elements = document.components.filter(c => c.kind !== "ground");
  const branches = elements.filter(c => c.kind === "voltageSource" || c.kind === "inductor" || (c.kind === "switch" && c.parameters.closed));
  const size = nodeCount - 1 + branches.length;
  if (!(Number.isFinite(duration) && duration > 0 && Number.isFinite(step) && step > 0 && step <= duration) || count > TRANSIENT_LIMITS.steps || size > TRANSIENT_LIMITS.unknowns || size ** 3 * count > TRANSIENT_LIMITS.work || (count + 1) * document.probes.length > TRANSIENT_LIMITS.samples) {
    throw new AnalysisFailure({ code: "invalid-input", message: "Transient run exceeds time-step, matrix or sample limits. Use a larger step, shorter duration, fewer probes or a smaller circuit.", relatedIds: [] });
  }
  let previous: DcResult;
  try { previous = solveDc(circuit); } catch (error) {
    if (error instanceof AnalysisFailure) throw new AnalysisFailure({ ...error.diagnostic, message: `Cannot initialize transient from DC: ${error.message}` });
    throw error;
  }
  const nodes = (id: string): [number, number] => [nodeByPin[pinKey(id, "a")]!, nodeByPin[pinKey(id, "b")]!];
  const branchIndex = new Map(branches.map((c, i) => [c.id, nodeCount - 1 + i]));
  const result: TransientResult = { kind: "transient", timesSeconds: [], probes: Object.create(null) };
  for (const probe of document.probes) result.probes[probe.id] = [];
  const record = (time: number): void => {
    result.timesSeconds.push(time);
    for (const probe of document.probes) {
      const value = probe.kind === "current" ? previous.branchAmps[probe.componentId] : previous.nodeVolts[nodeByPin[pinKey(probe.at.componentId, probe.at.pin)]!];
      if (value === undefined || !Number.isFinite(value)) throw new AnalysisFailure({ code: "ill-conditioned", message: "Transient probe is unavailable or non-finite. Check its anchor and component values.", relatedIds: [] });
      result.probes[probe.id]!.push(value);
    }
  };
  record(0);
  for (let index = 1; index <= count; index++) {
    const time = Math.min(index * step, duration);
    const dt = time - result.timesSeconds[index - 1]!;
    const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
    const rhs = Array<number>(size).fill(0);
    const stamp = (r: number, c: number, value: number): void => { if (r >= 0 && c >= 0) matrix[r]![c] = matrix[r]![c]! + value; };
    const inject = (node: number, value: number): void => { if (node > 0) rhs[node - 1] = rhs[node - 1]! + value; };
    for (const c of elements) {
      const [a, b] = nodes(c.id), ai = a - 1, bi = b - 1;
      if (c.kind === "resistor" || c.kind === "variableResistor" || c.kind === "lamp" || c.kind === "capacitor") {
        const g = c.kind === "capacitor" ? c.parameters.farads / dt : 1 / c.parameters.ohms;
        stamp(ai, ai, g); stamp(bi, bi, g); stamp(ai, bi, -g); stamp(bi, ai, -g);
        if (c.kind === "capacitor") {
          const history = g * (previous.nodeVolts[a]! - previous.nodeVolts[b]!);
          inject(a, history); inject(b, -history);
        }
      } else if (c.kind === "currentSource") {
        const current = sourceAt(c.parameters, time);
        inject(a, -current); inject(b, current);
      } else if (branchIndex.has(c.id)) {
        const branch = branchIndex.get(c.id)!;
        stamp(ai, branch, 1); stamp(bi, branch, -1); stamp(branch, ai, 1); stamp(branch, bi, -1);
        if (c.kind === "voltageSource") rhs[branch] = sourceAt(c.parameters, time);
        if (c.kind === "inductor") {
          const resistance = c.parameters.henrys / dt;
          stamp(branch, branch, -resistance);
          rhs[branch] = -resistance * previous.branchAmps[c.id]!;
        }
      }
    }
    try {
      const solution = solveLinear(matrix, rhs, branches.map(c => c.id));
      const nodeVolts = [0, ...solution.slice(0, nodeCount - 1)];
      const branchAmps: Record<string, number> = Object.create(null);
      for (const c of elements) {
        const [a, b] = nodes(c.id);
        const voltage = nodeVolts[a]! - nodeVolts[b]!;
        let current = 0;
        if (c.kind === "resistor" || c.kind === "variableResistor" || c.kind === "lamp") current = voltage / c.parameters.ohms;
        else if (c.kind === "capacitor") current = c.parameters.farads / dt * (voltage - (previous.nodeVolts[a]! - previous.nodeVolts[b]!));
        else if (c.kind === "currentSource") current = sourceAt(c.parameters, time);
        else if (branchIndex.has(c.id)) current = solution[branchIndex.get(c.id)!]!;
        if (!Number.isFinite(current)) throw new AnalysisFailure({ code: "ill-conditioned", message: "Non-finite transient current. Reduce extreme values or increase the time step.", relatedIds: [c.id] });
        branchAmps[c.id] = current;
      }
      previous = { kind: "dc", nodeVolts, branchAmps };
      record(time);
    } catch (error) {
      if (error instanceof AnalysisFailure) throw new AnalysisFailure({ ...error.diagnostic, message: `${error.message} (at ${time.toPrecision(6)} s)` });
      throw error;
    }
  }
  return result;
}
