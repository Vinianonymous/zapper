import type { CircuitDocument, Component, ComponentKind } from "./contracts";

export function emptyDocument(): CircuitDocument {
  return { schemaVersion: 1, components: [], wires: [], junctions: [], probes: [], settings: {
    ac: { startHz: 1, stopHz: 100000, points: 1000 }, transient: { durationSeconds: .05, stepSeconds: .00001 },
  } };
}

export const KIND_LABELS: Record<ComponentKind, string> = {
  resistor: "Resistor", capacitor: "Capacitor", inductor: "Inductor", voltageSource: "Voltage source",
  currentSource: "Current source", switch: "Switch", ground: "Ground",
};

export function newComponent(kind: ComponentKind, existing: Component[]): Component {
  const prefix = { resistor: "R", capacitor: "C", inductor: "L", voltageSource: "V", currentSource: "I", switch: "S", ground: "G" }[kind];
  let number = 1;
  while (existing.some((c) => c.ref === `${prefix}${number}`)) number++;
  const base = { id: crypto.randomUUID(), ref: `${prefix}${number}`, position: { x: 0, y: 0 }, rotation: 0 as const };
  switch (kind) {
    case "resistor": return { ...base, kind, parameters: { ohms: 1000 } };
    case "capacitor": return { ...base, kind, parameters: { farads: 1e-6 } };
    case "inductor": return { ...base, kind, parameters: { henrys: .001 } };
    case "voltageSource":
    case "currentSource": return { ...base, kind, parameters: { dc: kind === "voltageSource" ? 10 : .001, acMagnitude: 0, acPhaseDegrees: 0, transient: { kind: "dc" } } };
    case "switch": return { ...base, kind, parameters: { closed: true } };
    case "ground": return { ...base, kind, parameters: {} };
  }
}

export function dividerExample(withSwitch = false): CircuitDocument {
  const doc = emptyDocument();
  doc.components = [
    { ...newComponent("voltageSource", []), id: "v1", ref: "V1", position: { x: 0, y: 4 }, rotation: 90 },
    { ...newComponent("resistor", []), id: "r1", ref: "R1", position: { x: 6, y: 0 } },
    { ...newComponent("resistor", []), id: "r2", ref: "R2", position: { x: 12, y: 4 }, rotation: 90 },
    { ...newComponent("ground", []), id: "g1", ref: "G1", position: { x: 0, y: 8 } },
  ];
  doc.wires = [
    { id: "w1", points: [{ x: 0, y: 2 }, { x: 0, y: 0 }, { x: 4, y: 0 }] },
    { id: "w2", points: [{ x: 8, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 2 }] },
    { id: "w3", points: [{ x: 12, y: 6 }, { x: 12, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 6 }] },
  ];
  if (withSwitch) {
    doc.components.push({ ...newComponent("switch", []), id: "s1", ref: "S1", position: { x: 2, y: 0 } });
    doc.wires[0] = { id: "w1", points: [{ x: 0, y: 2 }, { x: 0, y: 0 }] };
  }
  doc.probes = [{ id: "pv", kind: "voltage", at: { componentId: "r2", pin: "a" } }, { id: "pi", kind: "current", componentId: "r1" }];
  return doc;
}

/** 1 V AC source → 1 kΩ → 1 µF → ground: −3 dB and −45° at 159.15 Hz. */
export function rcLowPassExample(): CircuitDocument {
  const doc = emptyDocument();
  doc.settings.ac = { startHz: 10, stopHz: 100_000, points: 101 };
  doc.components = [
    {
      id: "v1", ref: "V1", kind: "voltageSource", position: { x: 0, y: 4 }, rotation: 90,
      parameters: { dc: 0, acMagnitude: 1, acPhaseDegrees: 0, transient: { kind: "dc" } },
    },
    { id: "r1", ref: "R1", kind: "resistor", position: { x: 6, y: 0 }, rotation: 0, parameters: { ohms: 1000 } },
    { id: "c1", ref: "C1", kind: "capacitor", position: { x: 12, y: 4 }, rotation: 90, parameters: { farads: 1e-6 } },
    { id: "g1", ref: "G1", kind: "ground", position: { x: 0, y: 8 }, rotation: 0, parameters: {} },
  ];
  doc.wires = [
    { id: "w1", points: [{ x: 0, y: 2 }, { x: 0, y: 0 }, { x: 4, y: 0 }] },
    { id: "w2", points: [{ x: 8, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 2 }] },
    { id: "w3", points: [{ x: 12, y: 6 }, { x: 12, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 6 }] },
  ];
  doc.probes = [
    { id: "pa-in", kind: "voltage", at: { componentId: "r1", pin: "a" } },
    { id: "pa-out", kind: "voltage", at: { componentId: "c1", pin: "a" } },
    { id: "pa-current", kind: "current", componentId: "r1" },
  ];
  return doc;
}

/** Named starter circuits used by the Example menu. */
export function rlcTransientExample(): CircuitDocument {
  const doc = rcLowPassExample();
  doc.settings.transient = { durationSeconds: .02, stepSeconds: .00001 };
  const source = doc.components[0]!;
  if (source.kind === "voltageSource") source.parameters.transient = { kind: "pulse", low: 0, high: 10, delay: .001, rise: .00001, fall: .00001, width: .03, period: .04 };
  const resistor = doc.components[1]!;
  if (resistor.kind === "resistor") resistor.parameters.ohms = 100;
  doc.components.push({ id: "l1", ref: "L1", kind: "inductor", position: { x: 10, y: 0 }, rotation: 0, parameters: { henrys: .1 } });
  doc.wires[1] = { id: "w2", points: [{ x: 12, y: 0 }, { x: 12, y: 2 }] };
  return doc;
}

export function exampleDocument(name: string): CircuitDocument {
  if (name === "blank") return emptyDocument();
  if (name === "switch") return dividerExample(true);
  if (name === "rc") return rcLowPassExample();
  if (name === "rlc") return rlcTransientExample();
  return dividerExample();
}
