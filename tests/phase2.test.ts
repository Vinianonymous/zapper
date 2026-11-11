import { describe, expect, it } from "vitest";
import type { CircuitDocument, Component, Wire } from "../src/model/contracts";
import { dividerExample, emptyDocument } from "../src/model/document";
import { formatValue, parseValue } from "../src/model/values";
import { importCircuit, serializeCircuit, validateDocument } from "../src/persistence/json";
import { readDcProbe } from "../src/probes/dc";
import { renderSchematic, schematicBounds } from "../src/rendering/schematic";
import { runAnalysis } from "../src/simulation/run";
import { validateDcInput } from "../src/simulation/validation";
import { solveDc } from "../src/solver/dc";
import { resolveCircuit } from "../src/topology/resolve";

function doc(components: Component[] = [], wires: Wire[] = []): CircuitDocument {
  return { ...emptyDocument(), components, wires };
}
const ground = (x = 0, y = 0): Component => ({ id: `g${x}_${y}`, ref: `GND${x}_${y}`, kind: "ground", position: { x, y }, rotation: 0, parameters: {} });
const resistor = (id: string, x: number, y: number, rotation: 0 | 90 = 0, ohms = 1000): Component => ({ id, ref: id, kind: "resistor", position: { x, y }, rotation, parameters: { ohms } });
const source = (id: string, x: number, y: number, dc = 10, rotation: 0 | 90 = 0): Component => ({
  id, ref: id, kind: "voltageSource", position: { x, y }, rotation,
  parameters: { dc, acMagnitude: 0, acPhaseDegrees: 0, transient: { kind: "dc" } },
});
const currentSource = (id: string, x: number, y: number, dc: number): Component => ({
  id, ref: id, kind: "currentSource", position: { x, y }, rotation: 0,
  parameters: { dc, acMagnitude: 0, acPhaseDegrees: 0, transient: { kind: "dc" } },
});

function failureCode(document: CircuitDocument): string | undefined {
  const response = runAnalysis({ type: "run", requestId: "x", revision: 0, kind: "dc", circuit: document });
  return response.type === "failure" ? response.code : undefined;
}

describe("topology", () => {
  it("extracts the divider ground and signal nets", () => {
    const resolved = resolveCircuit(dividerExample());
    expect(resolved.nodeCount).toBe(3);
    expect(resolved.nodeByPin["v1:a"]).toBe(1);
    expect(resolved.nodeByPin["r1:a"]).toBe(1);
    expect(resolved.nodeByPin["r1:b"]).toBe(2);
    expect(resolved.nodeByPin["r2:a"]).toBe(2);
    expect(resolved.nodeByPin["g1:gnd"]).toBe(0);
  });

  it("an interior crossing requires an explicit junction", () => {
    // Horizontal wire ends at R1/R2 pins. Vertical wire ends at R3/R4 pins.
    // The wires cross only in their interiors at 0,0; a component pin must not
    // be placed there, so the dot is the only connection.
    const components = [
      ground(-6, 0), resistor("R1", -4, 0), resistor("R2", 4, 0),
      resistor("R3", 0, -4, 90), resistor("R4", 0, 4, 90),
    ];
    const wires: Wire[] = [
      { id: "h", points: [{ x: -6, y: 0 }, { x: 6, y: 0 }] },
      { id: "v", points: [{ x: 0, y: -6 }, { x: 0, y: 6 }] },
    ];
    const separate = resolveCircuit(doc(components, wires));
    const joined = resolveCircuit({ ...doc(components, wires), junctions: [{ id: "j", position: { x: 0, y: 0 } }] });
    expect(separate.nodeByPin["R1:a"]).not.toBe(separate.nodeByPin["R3:a"]);
    expect(joined.nodeByPin["R1:a"]).toBe(joined.nodeByPin["R3:a"]);
  });

  it("connects a pin touching a wire interior and unifies all ground symbols", () => {
    // R1.a starts at 0,0 on the ground symbol's interior; R1.b is the free end.
    const d = doc([ground(0, 0), ground(10, 10), resistor("R1", 2, 0)]);
    const resolved = resolveCircuit(d);
    expect(resolved.nodeByPin["g0_0:gnd"]).toBe(0);
    expect(resolved.nodeByPin["g10_10:gnd"]).toBe(0);
    expect(resolved.nodeByPin["R1:a"]).toBe(0);
    expect(resolved.nodeByPin["R1:b"]).toBe(1);
  });
});

describe("DC analysis", () => {
  it("solves the voltage-divider fixture to 5 V and 5 mA", () => {
    const result = solveDc(resolveCircuit(dividerExample()));
    expect(result.nodeVolts[1]).toBeCloseTo(10, 9);
    expect(result.nodeVolts[2]).toBeCloseTo(5, 9);
    expect(result.branchAmps.r1).toBeCloseTo(.005, 9);
    expect(result.branchAmps.r2).toBeCloseTo(.005, 9);
    expect(result.branchAmps.v1).toBeCloseTo(-.005, 9);
  });

  it("treats a capacitor as open and an inductor as an ideal short at DC", () => {
    // V(a=-2,0 b=2,0) -> R(4..8) -> C/L(10..14), grounds at 2 and 14.
    const rc = doc([source("V1", 0, 0), resistor("R1", 6, 0), {
      id: "C1", ref: "C1", kind: "capacitor", position: { x: 12, y: 0 }, rotation: 0, parameters: { farads: 1e-6 },
    }, ground(2, 0), ground(14, 0)], [
      // Route above the source's ground pin at 2,0 instead of shorting it.
      { id: "w1", points: [{ x: -2, y: 0 }, { x: -2, y: -2 }, { x: 4, y: -2 }, { x: 4, y: 0 }] },
      { id: "w2", points: [{ x: 8, y: 0 }, { x: 10, y: 0 }] },
    ]);
    const cap = solveDc(resolveCircuit(rc));
    expect(cap.nodeVolts[1]).toBeCloseTo(10, 9);
    expect(cap.nodeVolts[2]).toBeCloseTo(10, 9);
    expect(cap.branchAmps.R1).toBeCloseTo(0, 12);

    rc.components[2] = { id: "L1", ref: "L1", kind: "inductor", position: { x: 12, y: 0 }, rotation: 0, parameters: { henrys: .001 } };
    const inductorResolved = resolveCircuit(rc);
    const inductor = solveDc(inductorResolved);
    expect(inductor.nodeVolts[inductorResolved.nodeByPin["L1:b"]!]).toBeCloseTo(0, 9);
    expect(inductor.branchAmps.R1).toBeCloseTo(.01, 9);
  });

  it("stamps an independent current source with its a → b direction", () => {
    // The source sends 1 mA from a to b; with b grounded, a sits at -1 V.
    const d = doc([currentSource("I1", 0, 0, .001), resistor("R1", 6, 0), ground(2, 0)]);
    d.wires = [
      { id: "top", points: [{ x: -2, y: 0 }, { x: -2, y: -2 }, { x: 4, y: -2 }, { x: 4, y: 0 }] },
      { id: "bottom", points: [{ x: 2, y: 0 }, { x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 0 }] },
    ];
    const resolved = resolveCircuit(d);
    const result = solveDc(resolved);
    expect(result.nodeVolts[resolved.nodeByPin["R1:a"]!]).toBeCloseTo(-1, 9);
    expect(result.branchAmps.R1).toBeCloseTo(-.001, 9);
    expect(result.branchAmps.I1).toBeCloseTo(.001, 9);
  });

  it("opens and closes a switch without showing a fake result", () => {
    const closedDoc = dividerExample(true);
    const closedResolved = resolveCircuit(closedDoc);
    const closed = solveDc(closedResolved);
    expect(closed.nodeVolts[closedResolved.nodeByPin["r2:a"]!]).toBeCloseTo(5, 9);

    const opened = dividerExample(true);
    const sw = opened.components.find((c) => c.kind === "switch")!;
    if (sw.kind === "switch") sw.parameters.closed = false;
    const resolved = resolveCircuit(opened);
    const result = solveDc(resolved);
    expect(result.nodeVolts[resolved.nodeByPin["v1:a"]!]).toBeCloseTo(10, 9); // source is still energized
    expect(result.nodeVolts[resolved.nodeByPin["r2:a"]!]).toBeCloseTo(0, 9); // divider is broken
    expect(result.branchAmps.r1).toBeCloseTo(0, 12);
  });

  it("reports missing ground, unconnected pins, floating nodes and contradictory sources", () => {
    expect(validateDcInput(doc([source("V1", 0, 0), resistor("R1", 6, 0)]))[0]?.code).toBe("missing-ground");
    expect(failureCode(doc([ground(), source("V1", 0, 0), resistor("R1", 6, 0)]))).toBe("unconnected-pin");

    const floating = doc([ground(0, 6), currentSource("I1", 0, 0, .001), resistor("R1", 0, 0)]);
    expect(failureCode(floating)).toBe("floating-net");

    const contradictory = doc([ground(-2, 0), source("V1", 0, 0, 10), source("V2", 0, 0, 5)]);
    expect(failureCode(contradictory)).toBe("contradictory-sources");
  });

  it("never returns non-finite values or a success for invalid input", () => {
    const invalid = dividerExample();
    invalid.components[1] = resistor("r1", 6, 0, 0, 0);
    expect(failureCode(invalid)).toBe("invalid-input");
    const result = solveDc(resolveCircuit(dividerExample()));
    expect(Object.values(result.nodeVolts).every(Number.isFinite)).toBe(true);
    expect(Object.values(result.branchAmps).every(Number.isFinite)).toBe(true);
  });

  it("maps voltage and current probes with readable references", () => {
    const example = dividerExample();
    const resolved = resolveCircuit(example);
    const result = solveDc(resolved);
    expect(readDcProbe(example.probes[0]!, resolved, result)).toMatchObject({
      value: 5, unit: "V", reference: "Relative to ground (node 0)",
    });
    expect(readDcProbe(example.probes[1]!, resolved, result)).toMatchObject({
      value: .005, unit: "A", reference: "Positive from pin a to pin b",
    });
    expect(readDcProbe({ id: "x", kind: "current", componentId: "missing" }, resolved, result).value).toBeNull();
  });

  it("dispatches AC and transient to their respective solvers", () => {
    expect(runAnalysis({ type: "run", requestId: "x", revision: 0, kind: "ac", circuit: dividerExample() })).toMatchObject({
      type: "success", result: { kind: "ac" },
    });
    expect(runAnalysis({ type: "run", requestId: "x", revision: 0, kind: "transient", circuit: dividerExample() })).toMatchObject({
      type: "success", result: { kind: "transient" },
    });
  });
});

describe("persistence and rendering", () => {
  it("round-trips a circuit and rejects unsupported or malformed input", () => {
    const example = dividerExample();
    expect(importCircuit(serializeCircuit(example))).toEqual(example);
    expect(() => importCircuit(JSON.stringify({ ...example, schemaVersion: 2 }))).toThrow(/schema/i);
    expect(() => importCircuit(JSON.stringify({ ...example, components: [{ id: "x" }] }))).toThrow(/Component|fields/);
    expect(() => validateDocument({ ...example, probes: [{ id: "p", kind: "current", componentId: "missing" }] })).toThrow(/probe/i);
  });

  it("formats and parses SI values", () => {
    expect(parseValue("4.7k")).toBe(4700);
    expect(parseValue("1 µF")).toBeCloseTo(1e-6);
    expect(formatValue(.005, "A")).toBe("5 mA");
  });

  it("renders a standalone dark SVG without external resources or unescaped labels", () => {
    const example = dividerExample();
    example.components[0]!.ref = '<script>alert(1)</script>';
    const rendered = renderSchematic(example);
    expect(rendered.svg).toContain('fill="#10141c"');
    expect(rendered.svg).toContain("viewBox=");
    expect(rendered.svg).not.toContain("<script>");
    expect(rendered.svg).not.toContain("href=");
    expect(rendered.svg).not.toContain("<foreignObject");
    expect(rendered.width).toBe(schematicBounds(example).width);
  });
});
