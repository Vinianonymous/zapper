import { describe, expect, it } from "vitest";
import { dividerExample, newComponent } from "../src/model/document";
import { emptyDocument } from "../src/model/document";
import { removeSelection, rotateComponentInDocument, setComponentPosition } from "../src/editor/operations";
import { pins } from "../src/model/geometry";
import { validateDocument } from "../src/persistence/json";
import { solveDc } from "../src/solver/dc";
import { solveAcAt } from "../src/solver/ac";
import { simulateTransient } from "../src/solver/transient";
import { resolveCircuit } from "../src/topology/resolve";

describe("additional resistive components", () => {
  for (const kind of ["variableResistor", "lamp"] as const) {
    it(`${kind} validates, serializes and simulates in every mode`, () => {
      const doc = dividerExample();
      const part = newComponent(kind, doc.components);
      part.id = "r1";
      part.position = { x: 6, y: 0 };
      doc.components[1] = part;
      const source = doc.components[0]!;
      if (source.kind === "voltageSource") source.parameters.acMagnitude = 10;
      doc.settings.transient = { durationSeconds: .001, stepSeconds: .001 };
      const circuit = resolveCircuit(validateDocument(JSON.parse(JSON.stringify(doc))));
      expect(solveDc(circuit).branchAmps.r1).toBeGreaterThan(0);
      expect(solveAcAt(circuit, 100).branchAmps.r1!.re).toBeGreaterThan(0);
      expect(simulateTransient(circuit).probes.pi).toHaveLength(2);
    });
  }
});

describe("component-owned wires", () => {
  it("follows moved and rotated pins, keeping all segments orthogonal", () => {
    const doc = dividerExample();
    setComponentPosition(doc, "r1", { x: 6, y: -2 });
    expect(doc.wires[0]!.points.at(-1)).toEqual({ x: 4, y: -2 });
    expect(doc.wires[1]!.points[0]).toEqual({ x: 8, y: -2 });
    rotateComponentInDocument(doc, "r1");
    expect(doc.wires[0]!.points.at(-1)).toEqual(pins(doc.components[1]!).find((p) => p.name === "a")!.position);
    expect(() => validateDocument(doc)).not.toThrow();
  });

  it("removes touching wires, orphan branches and probes when a part is erased", () => {
    const doc = dividerExample();
    doc.wires.push({ id: "branch", points: [{ x: 5, y: 0 }, { x: 5, y: -3 }] });
    removeSelection(doc, { type: "component", id: "r1" });
    expect(doc.wires.map((wire) => wire.id)).toEqual(["w3"]);
    expect(doc.probes.some((probe) => probe.kind === "current" && probe.componentId === "r1")).toBe(false);
    expect(() => validateDocument(doc)).not.toThrow();
  });

  it("removes disconnected cable groups when their last part is removed", () => {
    const doc = emptyDocument();
    const part = newComponent("lamp", []);
    doc.components.push(part);
    doc.wires = [{ id: "one", points: [{ x: -2, y: 0 }, { x: -4, y: 0 }] },
      { id: "two", points: [{ x: -4, y: 0 }, { x: -6, y: 0 }] }];
    removeSelection(doc, { type: "component", id: part.id });
    expect(doc.wires).toEqual([]);
  });
});
