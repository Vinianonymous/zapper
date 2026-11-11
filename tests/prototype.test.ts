import { describe, expect, it } from "vitest";
import { solveAC, solveDC, type PrototypeCircuit } from "../src/solver/prototype";

const divider: PrototypeCircuit = {
  nodeCount: 3,
  elements: [
    { kind: "voltageSource", a: 1, b: 0, dcVolts: 10 },
    { kind: "resistor", a: 1, b: 2, ohms: 1000 },
    { kind: "resistor", a: 2, b: 0, ohms: 1000 },
  ],
};

const rc: PrototypeCircuit = {
  nodeCount: 3,
  elements: [
    { kind: "voltageSource", a: 1, b: 0, dcVolts: 10, acVolts: { real: 1, imaginary: 0 } },
    { kind: "resistor", a: 1, b: 2, ohms: 1000 },
    { kind: "capacitor", a: 2, b: 0, farads: 1e-6 },
  ],
};

describe("phase 0 MNA prototype (already numbered nets)", () => {
  it("solves a 10 V voltage divider to 5 V and 5 mA", () => {
    const result = solveDC(divider);
    expect(result.nodeVolts[0]?.real).toBe(0);
    expect(result.nodeVolts[1]?.real).toBeCloseTo(10, 10);
    expect(result.nodeVolts[2]?.real).toBeCloseTo(5, 10);
    expect(result.sourceAmps[0]?.real).toBeCloseTo(-0.005, 10);
  });

  it("treats an RC capacitor as open at DC", () => {
    const result = solveDC(rc);
    expect(result.nodeVolts[2]?.real).toBeCloseTo(10, 10);
    expect(result.sourceAmps[0]?.real).toBeCloseTo(0, 10);
  });

  it("solves the RC -3 dB, -45 degree corner in AC", () => {
    const cutoff = 1 / (2 * Math.PI * 1000 * 1e-6);
    const output = solveAC(rc, cutoff).nodeVolts[2]!;
    expect(output.real).toBeCloseTo(0.5, 10);
    expect(output.imaginary).toBeCloseTo(-0.5, 10);
    expect(20 * Math.log10(Math.hypot(output.real, output.imaginary))).toBeCloseTo(-3.0103, 3);
    expect(Math.atan2(output.imaginary, output.real) * 180 / Math.PI).toBeCloseTo(-45, 8);
  });

  it("rejects a floating circuit instead of returning bogus results", () => {
    expect(() => solveDC({
      nodeCount: 3,
      elements: [
        { kind: "voltageSource", a: 1, b: 2, dcVolts: 10 },
        { kind: "resistor", a: 1, b: 2, ohms: 1000 },
      ],
    })).toThrow(/Singular/);
  });

  it("rejects contradictory voltage sources", () => {
    expect(() => solveDC({
      nodeCount: 2,
      elements: [
        { kind: "voltageSource", a: 1, b: 0, dcVolts: 10 },
        { kind: "voltageSource", a: 1, b: 0, dcVolts: 5 },
      ],
    })).toThrow(/Singular/);
  });

  it("rejects invalid values and AC frequencies", () => {
    expect(() => solveDC({ nodeCount: 2, elements: [{ kind: "resistor", a: 1, b: 0, ohms: 0 }] })).toThrow(/Resistance/);
    expect(() => solveAC(rc, 0)).toThrow(/frequency/);
  });
});
