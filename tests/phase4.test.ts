import { describe, expect, it } from "vitest";
import { dividerExample, rcLowPassExample, rlcTransientExample } from "../src/model/document";
import { resolveCircuit } from "../src/topology/resolve";
import { simulateTransient, sourceAt } from "../src/solver/transient";
import { runAnalysis } from "../src/simulation/run";
import { serializeCircuit, importCircuit } from "../src/persistence/json";
import { transientView } from "../src/ui/transient-chart";

function rcStep() {
  const doc = rcLowPassExample();
  doc.settings.transient = { durationSeconds: .006, stepSeconds: .00001 };
  const source = doc.components[0]!;
  if (source.kind !== "voltageSource") throw new Error("Missing source");
  source.parameters.transient = { kind: "pulse", low: 0, high: 10, delay: .001, rise: 0, fall: 0, width: .01, period: .02 };
  return doc;
}

describe("transient numerical fixtures", () => {
  it("meets the RC step acceptance criterion and approaches the final value monotonically", () => {
    const doc = rcStep();
    const result = simulateTransient(resolveCircuit(doc));
    const output = result.probes["pa-out"]!;
    expect(output[0]).toBe(0);
    expect(output[98]).toBe(0);
    expect(Math.abs(output[200]! / 10 - (1 - Math.exp(-1)))).toBeLessThan(.02 * .632);
    expect(output.at(-1)).toBeGreaterThan(9.9);
    for (let i = 1; i < output.length; i++) expect(output[i]!).toBeGreaterThanOrEqual(output[i - 1]! - 1e-12);
    // KCL: series resistor current equals capacitor current at every integrated step.
    doc.probes.push({ id: "ic", kind: "current", componentId: "c1" });
    const currents = simulateTransient(resolveCircuit(doc));
    currents.probes.ic!.forEach((value, index) => expect(value).toBeCloseTo(currents.probes["pa-current"]![index]!, 10));
  });

  it("initializes capacitor voltage and inductor current from DC rather than zero", () => {
    const doc = rlcTransientExample();
    const source = doc.components[0]!;
    if (source.kind !== "voltageSource") throw new Error("Missing source");
    source.parameters.dc = 5;
    source.parameters.transient = { kind: "dc" };
    doc.probes.push({ id: "il", kind: "current", componentId: "l1" });
    const result = simulateTransient(resolveCircuit(doc));
    result.probes["pa-out"]!.forEach(v => expect(v).toBeCloseTo(5, 8));
    result.probes.il!.forEach(v => expect(v).toBeCloseTo(0, 8));
  });

  it("shows damped RLC overshoot and finite currents", () => {
    const doc = rlcTransientExample();
    const result = simulateTransient(resolveCircuit(doc));
    expect(Math.max(...result.probes["pa-out"]!)).toBeGreaterThan(12);
    expect(result.probes["pa-out"]!.at(-1)).toBeCloseTo(10, 1);
    Object.values(result.probes).forEach(values => expect(values.every(Number.isFinite)).toBe(true));
    expect(importCircuit(serializeCircuit(doc))).toEqual(doc);
  });

  it("dissipates stored RLC energy after removing the source", () => {
    const doc = rlcTransientExample();
    const source = doc.components[0]!;
    if (source.kind !== "voltageSource") throw new Error("Missing source");
    source.parameters.dc = 10;
    source.parameters.transient = { kind: "sine", offset: 0, amplitude: 0, frequency: 1, phaseDegrees: 0 };
    doc.probes.push({ id: "il", kind: "current", componentId: "l1" });
    const result = simulateTransient(resolveCircuit(doc));
    let energy = Infinity;
    result.probes["pa-out"]!.forEach((voltage, index) => {
      const current = result.probes.il![index]!;
      const next = .5 * 1e-6 * voltage ** 2 + .5 * .1 * current ** 2;
      expect(next).toBeLessThanOrEqual(energy + 1e-14);
      energy = next;
    });
    expect(energy).toBeLessThan(1e-10);
  });

  it("uses sine waveforms for current sources with the signed a → b convention", () => {
    const doc = dividerExample();
    const source = doc.components[0]!;
    if (source.kind !== "voltageSource") throw new Error("Missing source");
    doc.components[0] = { ...source, kind: "currentSource", parameters: { ...source.parameters, dc: 0, transient: { kind: "sine", offset: 0, amplitude: .01, frequency: 1000, phaseDegrees: 0 } } };
    doc.settings.transient = { durationSeconds: .001, stepSeconds: .00001 };
    const result = simulateTransient(resolveCircuit(doc));
    expect(result.probes.pv![25]).toBeCloseTo(-10, 9);
    expect(result.probes.pi![25]).toBeCloseTo(-.01, 9);
    expect(result.probes.pv![75]).toBeCloseTo(10, 9);
  });

  it("keeps switch states fixed and handles a partial final step", () => {
    const doc = dividerExample(true);
    doc.settings.transient = { durationSeconds: .00105, stepSeconds: .0001 };
    for (const closed of [true, false]) {
      const sw = doc.components.find(c => c.kind === "switch")!;
      if (sw.kind === "switch") sw.parameters.closed = closed;
      const result = simulateTransient(resolveCircuit(doc));
      expect(result.timesSeconds.at(-1)).toBe(.00105);
      result.probes.pv!.forEach(v => expect(v).toBeCloseTo(closed ? 5 : 0, 9));
    }
  });

  it("reports initialization failure without inventing initial conditions", () => {
    const doc = rcStep();
    doc.components = doc.components.filter(c => c.id !== "r1");
    doc.probes = [];
    const response = runAnalysis({ type: "run", requestId: "t", revision: 0, kind: "transient", circuit: doc });
    expect(response).toMatchObject({ type: "failure" });
    if (response.type === "failure") expect(response.message).toContain("initialize transient from DC");
    expect(response).not.toHaveProperty("result");
  });

  it("rejects invalid and excessive work before allocating results", () => {
    for (const [durationSeconds, stepSeconds] of [[0, 1], [1, 0], [1, 2], [1, 1e-9], [Infinity, 1]]) {
      const doc = rcStep();
      doc.settings.transient = { durationSeconds: durationSeconds!, stepSeconds: stepSeconds! };
      expect(() => simulateTransient(resolveCircuit(doc))).toThrow(/limits/);
    }
  });
});

describe("source waveforms and charts", () => {
  it("evaluates sine phase, pulse delay/edges/plateau/repetition and DC separately", () => {
    const source = { dc: 7, acMagnitude: 99, acPhaseDegrees: 0, transient: { kind: "dc" as const } };
    expect(sourceAt(source, 1)).toBe(7);
    expect(sourceAt({ ...source, transient: { kind: "sine", offset: 2, amplitude: 3, frequency: 1, phaseDegrees: 90 } }, 0)).toBeCloseTo(5);
    const pulse = { ...source, transient: { kind: "pulse" as const, low: 1, high: 5, delay: 1, rise: 1, width: 1, fall: 1, period: 4 } };
    for (const [time, value] of [[0, 1], [1, 1], [1.5, 3], [2.5, 5], [3.5, 3], [4.5, 1], [5.5, 3]]) expect(sourceAt(pulse, time!)).toBeCloseTo(value!);
  });

  it("renders separate V/A axes, multiple probes, sample controls and safe labels", () => {
    const doc = rcStep();
    doc.components[1]!.ref = "<script>";
    const html = transientView(doc, simulateTransient(resolveCircuit(doc)), 100);
    expect(html).toContain("Voltage (V)");
    expect(html).toContain("Current (A)");
    expect(html).toContain('id="transient-cursor"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<script>|NaN|Infinity/);
  });
});
