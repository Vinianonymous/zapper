import { describe, expect, it } from "vitest";
import type { CircuitDocument } from "../src/model/contracts";
import { rcLowPassExample, dividerExample } from "../src/model/document";
import { validateAcInput } from "../src/simulation/validation";
import { runAnalysis } from "../src/simulation/run";
import { probeComplex, solveAcAt, sweepAc } from "../src/solver/ac";
import { resolveCircuit } from "../src/topology/resolve";
import {
  acCursorX, acIndexAtX, acPlot, acPlotGeometry, formatPhase, magnitudeDb, type AcSeries,
} from "../src/ui/ac-chart";

const R = 1000;
const C = 1e-6;
const cutoffHz = 1 / (2 * Math.PI * R * C);

function withSweep(document: CircuitDocument, startHz: number, stopHz: number, points: number): CircuitDocument {
  document.settings.ac = { startHz, stopHz, points };
  return document;
}

function failureCode(document: CircuitDocument): string | undefined {
  const response = runAnalysis({ type: "run", requestId: "ac", revision: 0, kind: "ac", circuit: document });
  return response.type === "failure" ? response.code : undefined;
}

describe("AC solver", () => {
  it("solves the RC low-pass corner at −3 dB and −45 degrees", () => {
    const document = withSweep(rcLowPassExample(), cutoffHz, cutoffHz * 2, 2);
    const resolved = resolveCircuit(document);
    const result = sweepAc(resolved, document.settings.ac);

    expect(result.frequenciesHz[0]).toBeCloseTo(cutoffHz, 6);
    const input = result.probes["pa-in"]!;
    const output = result.probes["pa-out"]!;
    expect(input.magnitude[0]).toBeCloseTo(1, 9);
    expect(input.phaseDegrees[0]).toBeCloseTo(0, 9);
    expect(output.magnitude[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(output.phaseDegrees[0]).toBeCloseTo(-45, 5);
  });

  it("uses V(t) = Re{V e^{jωt}} for current phase as well as voltage", () => {
    const document = withSweep(rcLowPassExample(), cutoffHz, cutoffHz * 2, 2);
    const resolved = resolveCircuit(document);
    const point = solveAcAt(resolved, cutoffHz);
    const current = probeComplex(document.probes.find((probe) => probe.id === "pa-current")!, resolved, point)!;
    // I = Vin / (R + 1/jωC) leads the source by +45° at the corner.
    expect(Math.atan2(current.im, current.re) * 180 / Math.PI).toBeCloseTo(45, 5);
    expect(Math.hypot(current.im, current.re)).toBeCloseTo(Math.SQRT1_2 / R, 9);
  });

  it("spaces points logarithmically and includes both endpoints", () => {
    const document = rcLowPassExample();
    const result = sweepAc(resolveCircuit(document), document.settings.ac);
    expect(result.frequenciesHz).toHaveLength(document.settings.ac.points);
    expect(result.frequenciesHz[0]).toBe(10);
    expect(result.frequenciesHz.at(-1)).toBe(100_000);
    const ratio = result.frequenciesHz[1]! / result.frequenciesHz[0]!;
    for (let index = 1; index < result.frequenciesHz.length; index += 1) {
      expect(result.frequenciesHz[index]! / result.frequenciesHz[index - 1]!).toBeCloseTo(ratio, 12);
    }
    // A low-pass starts near unity and rolls off toward −90°.
    const output = result.probes["pa-out"]!;
    const firstRatio = 10 / cutoffHz;
    expect(output.magnitude[0]).toBeCloseTo(1 / Math.hypot(1, firstRatio), 9);
    expect(output.phaseDegrees[0]).toBeCloseTo(-Math.atan(firstRatio) * 180 / Math.PI, 9);
    expect(output.magnitude.at(-1)!).toBeLessThan(0.002);
    expect(output.phaseDegrees.at(-1)!).toBeLessThan(-89);
  });

  it("models an inductor with +jωL and leads the output by +45° at its corner", () => {
    const document = withSweep(rcLowPassExample(), cutoffHz, cutoffHz * 2, 2);
    const index = document.components.findIndex((component) => component.id === "c1");
    const capacitor = document.components[index]!;
    if (capacitor.kind !== "capacitor") throw new Error("Fixture capacitor missing");
    document.components[index] = {
      id: capacitor.id, ref: capacitor.ref, kind: "inductor", position: capacitor.position,
      rotation: capacitor.rotation, parameters: { henrys: 1 },
    };
    const result = sweepAc(resolveCircuit(document), document.settings.ac);
    const output = result.probes["pa-out"]!;
    expect(output.magnitude[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(output.phaseDegrees[0]).toBeCloseTo(45, 5);
  });

  it("returns a valid all-zero sweep when the source has no AC excitation", () => {
    const document = rcLowPassExample();
    const source = document.components.find((component) => component.id === "v1");
    if (!source || source.kind !== "voltageSource") throw new Error("Fixture source missing");
    source.parameters.dc = 1000; // DC must not leak into AC.
    source.parameters.acMagnitude = 0;
    const result = sweepAc(resolveCircuit(document), document.settings.ac);
    expect(result.frequenciesHz).toHaveLength(101);
    for (const probe of Object.values(result.probes)) {
      expect(probe.magnitude.every((value) => value === 0)).toBe(true);
      expect(probe.phaseDegrees.every((value) => value === 0)).toBe(true);
    }
  });

  it("rejects invalid sweep ranges before solving", () => {
    for (const [startHz, stopHz, points] of [
      [0, 10, 10],
      [-1, 10, 10],
      [10, 10, 10],
      [10, 5, 10],
      [10, 1000, 1],
      [10, 1000, 2.5],
      [10, 1000, 10_001],
    ] as const) {
      const document = withSweep(rcLowPassExample(), startHz, stopHz, points);
      expect(validateAcInput(document)[0]?.code).toBe("invalid-input");
      expect(failureCode(document)).toBe("invalid-input");
      expect(() => sweepAc(resolveCircuit(document), document.settings.ac)).toThrow();
    }
  });

  it("reports contradictory AC sources instead of hiding the conflict", () => {
    const document = dividerExample();
    const source = document.components.find((component) => component.id === "v1");
    if (!source || source.kind !== "voltageSource") throw new Error("Fixture source missing");
    source.parameters.acMagnitude = 1;
    const second = structuredClone(source);
    second.id = "v2";
    second.ref = "V2";
    second.parameters.acMagnitude = 0.5;
    document.components.push(second);
    expect(failureCode(document)).toBe("contradictory-sources");
  });
});

describe("AC charts", () => {
  it("renders large multi-probe sweeps without exceeding argument limits", () => {
    const frequencies = Array.from({ length: 10_000 }, (_, index) => 10 ** (index / 2500));
    const series: AcSeries[] = Array.from({ length: 20 }, (_, index) => ({
      probeId: `p${index}`, label: `Probe ${index}`, unit: "V", color: "#80c9ff",
      magnitude: frequencies.map(() => 0.5), phaseDegrees: frequencies.map(() => -45),
    }));
    const plot = acPlot(frequencies, series, "magnitude", 0);
    expect(plot.svg.match(/<polyline /g)).toHaveLength(20);
    expect(plot.svg).toContain('stroke-dasharray="8 4"');
    expect(plot.svg).not.toMatch(/NaN|Infinity/);
  });

  it("maps a logarithmic cursor, formats sign conventions and emits standalone SVG", () => {
    const frequencies = [10, 100, 1000];
    const geometry = acPlotGeometry(frequencies);
    expect(acIndexAtX(geometry, frequencies, geometry.left)).toBe(0);
    expect(acIndexAtX(geometry, frequencies, geometry.left + geometry.plotWidth)).toBe(2);
    expect(acIndexAtX(geometry, frequencies, geometry.left + geometry.plotWidth / 2)).toBe(1);
    expect(acCursorX(geometry, 2)).toBeCloseTo(geometry.left + geometry.plotWidth, 9);
    expect(formatPhase(-0)).toBe("0°");
    expect(formatPhase(-45)).toBe("-45°");
    expect(magnitudeDb(1)).toBe(0);
    expect(magnitudeDb(Math.SQRT1_2)).toBeCloseTo(-3.0103, 3);

    const series: AcSeries[] = [{
      probeId: "p", label: "Output", unit: "V", color: "#80c9ff",
      magnitude: [1, 0.5, 0.25], phaseDegrees: [0, -45, -70],
    }];
    const plot = acPlot(frequencies, series, "magnitude", 1);
    expect(plot.svg).toContain("<polyline");
    expect(plot.svg).toContain("Magnitude (dB)");
    expect(plot.svg).not.toContain("href=");
    expect(plot.svg).not.toContain("<script");
  });
});
