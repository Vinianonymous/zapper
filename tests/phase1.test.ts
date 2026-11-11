import { describe, expect, it } from "vitest";
import type { CircuitDocument, Component } from "../src/model/contracts";
import { dividerExample, emptyDocument } from "../src/model/document";
import { insertComponent, removeSelection, routeWire, toggleCurrentProbe, toggleVoltageProbe, addWire, addJunction } from "../src/editor/operations";
import { resolveCircuit } from "../src/topology/resolve";
import { importCircuit, serializeCircuit, validateDocument } from "../src/persistence/json";
import { formatValue, parseValue } from "../src/model/values";

function resistor(id: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): Component {
  return { id, ref: id.toUpperCase(), kind: "resistor", position: { x, y }, rotation, parameters: { ohms: 1000 } };
}

function documentWith(components: Component[], wires: CircuitDocument["wires"], junctions: CircuitDocument["junctions"] = []): CircuitDocument {
  return { ...emptyDocument(), components, wires, junctions };
}

const node = (circuit: ReturnType<typeof resolveCircuit>, id: string, pin: "a" | "b" | "gnd"): number => circuit.nodeByPin[`${id}:${pin}`]!;

describe("Phase 1 topology", () => {
  it("does not connect two interior wire crossings", () => {
    const document = documentWith(
      [resistor("h1", -2, 0), resistor("h2", 8, 0), resistor("v1", 3, -5, 90), resistor("v2", 3, 5, 90)],
      [
        { id: "horizontal", points: [{ x: 0, y: 0 }, { x: 6, y: 0 }] },
        { id: "vertical", points: [{ x: 3, y: -3 }, { x: 3, y: 3 }] },
      ],
    );
    const circuit = resolveCircuit(document);
    expect(node(circuit, "h1", "b")).toBe(node(circuit, "h2", "a"));
    expect(node(circuit, "v1", "b")).toBe(node(circuit, "v2", "a"));
    expect(node(circuit, "h1", "b")).not.toBe(node(circuit, "v1", "b"));
  });

  it("connects the same crossing only when an explicit junction is present", () => {
    const document = documentWith(
      [resistor("h1", -2, 0), resistor("h2", 8, 0), resistor("v1", 3, -5, 90), resistor("v2", 3, 5, 90)],
      [
        { id: "horizontal", points: [{ x: 0, y: 0 }, { x: 6, y: 0 }] },
        { id: "vertical", points: [{ x: 3, y: -3 }, { x: 3, y: 3 }] },
      ],
      [{ id: "dot", position: { x: 3, y: 0 } }],
    );
    const circuit = resolveCircuit(document);
    expect(node(circuit, "h1", "b")).toBe(node(circuit, "v1", "b"));
    expect(node(circuit, "h1", "b")).toBe(node(circuit, "h2", "a"));
  });

  it("connects a wire endpoint touching another wire interior as a T-junction", () => {
    const document = documentWith(
      [resistor("left", -2, 0), resistor("right", 12, 0), resistor("branch", 5, 6, 90)],
      [
        { id: "horizontal", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { id: "branch", points: [{ x: 5, y: 0 }, { x: 5, y: 4 }] },
      ],
    );
    const circuit = resolveCircuit(document);
    expect(node(circuit, "left", "b")).toBe(node(circuit, "right", "a"));
    expect(node(circuit, "left", "b")).toBe(node(circuit, "branch", "a"));
  });

  it("treats collinear overlapping wires as one net", () => {
    const document = documentWith(
      [resistor("left", -2, 0), resistor("right", 8, 0)],
      [
        { id: "one", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] },
        { id: "two", points: [{ x: 2, y: 0 }, { x: 6, y: 0 }] },
      ],
    );
    const circuit = resolveCircuit(document);
    expect(node(circuit, "left", "b")).toBe(node(circuit, "right", "a"));
  });

  it("maps every ground symbol to node zero while keeping islands separate", () => {
    const document = dividerExample();
    const circuit = resolveCircuit(document);
    expect(node(circuit, "g1", "gnd")).toBe(0);
    expect(circuit.nodeCount).toBeGreaterThanOrEqual(3);
  });
});

describe("Phase 1 persistence", () => {
  it("round-trips a component, wire, junction and probe without changing data", () => {
    const source = dividerExample();
    source.junctions.push({ id: "j1", position: { x: 4, y: 4 } });
    const parsed = importCircuit(serializeCircuit(source));
    expect(parsed).toEqual(source);
  });

  it("rejects unsupported versions, duplicate IDs and non-orthogonal wires", () => {
    expect(() => validateDocument({ ...emptyDocument(), schemaVersion: 2 })).toThrow(/schema/i);
    const duplicate = dividerExample();
    duplicate.components.push({ ...duplicate.components[0]!, id: duplicate.components[0]!.id, ref: "R99" });
    expect(() => validateDocument(duplicate)).toThrow(/unique|duplicate/i);
    expect(() => validateDocument({ ...emptyDocument(), wires: [{ id: "w", points: [{ x: 0, y: 0 }, { x: 2, y: 3 }] }] })).toThrow(/orthogonal/i);
  });

  it("does not accept unknown fields or probes pointing at missing parts", () => {
    const extra = { ...emptyDocument(), unexpected: true };
    expect(() => validateDocument(extra)).toThrow(/unsupported fields/i);
    expect(() => validateDocument({ ...emptyDocument(), probes: [{ id: "p", kind: "current", componentId: "missing" }] })).toThrow(/two-pin/i);
  });
});

describe("Phase 1 editor operations", () => {
  it("routes horizontal, vertical and Shift elbows deterministically", () => {
    expect(routeWire({ x: 0, y: 0 }, { x: 0, y: 4 })).toEqual([{ x: 0, y: 0 }, { x: 0, y: 4 }]);
    expect(routeWire({ x: 0, y: 0 }, { x: 4, y: 4 })).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]);
    expect(routeWire({ x: 0, y: 0 }, { x: 4, y: 4 }, true)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 4, y: 4 }]);
    expect(routeWire({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([]);
  });

  it("adds unique references and removes connected probes with a component", () => {
    const document = emptyDocument();
    const first = insertComponent(document, "resistor", { x: 0, y: 0 });
    const second = insertComponent(document, "resistor", { x: 4, y: 0 });
    insertComponent(document, "ground", { x: 0, y: 4 });
    expect(first.ref).toBe("R1");
    expect(second.ref).toBe("R2");
    expect(first.id).not.toBe(second.id);
    toggleVoltageProbe(document, first.id, "a");
    toggleCurrentProbe(document, first.id);
    expect(document.probes).toHaveLength(2);
    removeSelection(document, { type: "component", id: first.id });
    expect(document.probes).toHaveLength(0);
  });

  it("adds wires and junctions and rejects duplicate junctions", () => {
    const document = emptyDocument();
    expect(addWire(document, { x: 0, y: 0 }, { x: 4, y: 4 })?.points).toHaveLength(3);
    expect(addWire(document, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(addJunction(document, { x: 2, y: 2 })).toBe(true);
    expect(addJunction(document, { x: 2, y: 2 })).toBe(false);
    expect(document.junctions).toHaveLength(1);
  });

  it("parses and formats SI values without partial-string mistakes", () => {
    expect(parseValue("1k")).toBe(1000);
    expect(parseValue("4.7uF")).toBeCloseTo(4.7e-6);
    expect(parseValue("1 kΩ")).toBe(1000);
    expect(() => parseValue("12x")).toThrow();
    expect(formatValue(1000, "Ω")).toBe("1 kΩ");
    expect(formatValue(1e-6, "F")).toBe("1 µF");
  });
});
