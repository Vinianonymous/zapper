import type { AnalysisSettings, CircuitDocument, Component, ComponentKind, Junction, PinName, Point, Probe, Rotation, Waveform, Wire } from "./contracts";

const record = (value: unknown, where: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where} must be an object`);
  return value as Record<string, unknown>;
};
const array = (value: unknown, where: string, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${where} must be an array of at most ${max} items`);
  return value as unknown[];
};
const text = (value: unknown, where: string): string => {
  if (typeof value !== "string" || !value || value.length > 100 || /[\x00-\x1f]/.test(value)) throw new Error(`${where} must be a nonempty short string`);
  return value;
};
const number = (value: unknown, where: string, min = -1e12, max = 1e12): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${where} must be a finite number from ${min} to ${max}`);
  return value;
};
const position = (value: unknown, where: string): Point => {
  const p = record(value, where);
  const x = number(p.x, `${where}.x`, -10000, 10000), y = number(p.y, `${where}.y`, -10000, 10000);
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`${where} must use integer grid coordinates`);
  return { x, y };
};
function unique(id: string, used: Set<string>, where: string): void {
  if (used.has(id)) throw new Error(`${where}: duplicate ID ${id}`);
  used.add(id);
}

function waveform(value: unknown, where: string): Waveform {
  const data = record(value, where);
  if (data.kind === "dc") return { kind: "dc" };
  if (data.kind === "sine") return {
    kind: "sine", offset: number(data.offset, `${where}.offset`), amplitude: number(data.amplitude, `${where}.amplitude`, 0),
    frequency: number(data.frequency, `${where}.frequency`, 0.000000001), phaseDegrees: number(data.phaseDegrees, `${where}.phaseDegrees`),
  };
  if (data.kind === "pulse") {
    const result: Waveform = {
      kind: "pulse", low: number(data.low, `${where}.low`), high: number(data.high, `${where}.high`),
      delay: number(data.delay, `${where}.delay`, 0), rise: number(data.rise, `${where}.rise`, 0),
      fall: number(data.fall, `${where}.fall`, 0), width: number(data.width, `${where}.width`, 0),
      period: number(data.period, `${where}.period`, 0.000000001),
    };
    if (result.width + result.rise + result.fall > result.period) throw new Error(`${where}: pulse phases exceed period`);
    return result;
  }
  throw new Error(`${where}: unsupported waveform`);
}

export function validateDocument(input: unknown): CircuitDocument {
  const raw = record(input, "Circuit");
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported circuit schema version: ${String(raw.schemaVersion)}`);
  const ids = new Set<string>(), refs = new Set<string>();
  const kinds: ComponentKind[] = ["resistor", "capacitor", "inductor", "voltageSource", "currentSource", "switch", "ground"];
  const components = array(raw.components, "components", 500).map((entry, i): Component => {
    const label = `components[${i}]`, c = record(entry, label), id = text(c.id, `${label}.id`), ref = text(c.ref, `${label}.ref`);
    unique(id, ids, label);
    if (refs.has(ref)) throw new Error(`${label}: duplicate reference ${ref}`);
    refs.add(ref);
    if (!kinds.includes(c.kind as ComponentKind)) throw new Error(`${label}: unknown component type`);
    const kind = c.kind as ComponentKind, p = record(c.parameters, `${label}.parameters`);
    const rotation = number(c.rotation, `${label}.rotation`, 0, 270);
    if (![0, 90, 180, 270].includes(rotation)) throw new Error(`${label}: invalid rotation`);
    const base = { id, ref, position: position(c.position, `${label}.position`), rotation: rotation as Rotation };
    switch (kind) {
      case "resistor": return { ...base, kind, parameters: { ohms: number(p.ohms, `${label}.ohms`, 1e-12) } };
      case "capacitor": return { ...base, kind, parameters: { farads: number(p.farads, `${label}.farads`, 1e-12) } };
      case "inductor": return { ...base, kind, parameters: { henrys: number(p.henrys, `${label}.henrys`, 1e-12) } };
      case "switch": {
        if (typeof p.closed !== "boolean") throw new Error(`${label}.closed must be a boolean`);
        return { ...base, kind, parameters: { closed: p.closed } };
      }
      case "ground": return { ...base, kind, parameters: {} };
      case "voltageSource": case "currentSource": return { ...base, kind, parameters: {
        dc: number(p.dc, `${label}.dc`), acMagnitude: number(p.acMagnitude, `${label}.acMagnitude`, 0),
        acPhaseDegrees: number(p.acPhaseDegrees, `${label}.acPhaseDegrees`), transient: waveform(p.transient, `${label}.transient`),
      } };
    }
  });
  const wires = array(raw.wires, "wires", 2000).map((entry, i): Wire => {
    const label = `wires[${i}]`, w = record(entry, label), id = text(w.id, `${label}.id`);
    unique(id, ids, label);
    const points = array(w.points, `${label}.points`, 100).map((p, index) => position(p, `${label}.points[${index}]`));
    if (points.length < 2) throw new Error(`${label}: wire needs two points`);
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1]!, b = points[j]!;
      if ((a.x === b.x) === (a.y === b.y)) throw new Error(`${label}: wire segments must be nonzero and orthogonal`);
    }
    return { id, points };
  });
  const junctions = array(raw.junctions, "junctions", 2000).map((entry, i): Junction => {
    const label = `junctions[${i}]`, j = record(entry, label), id = text(j.id, `${label}.id`);
    unique(id, ids, label);
    return { id, position: position(j.position, `${label}.position`) };
  });
  const byId = new Map(components.map((c) => [c.id, c]));
  const probes = array(raw.probes, "probes", 500).map((entry, i): Probe => {
    const label = `probes[${i}]`, p = record(entry, label), id = text(p.id, `${label}.id`);
    unique(id, ids, label);
    if (p.kind === "current") {
      const componentId = text(p.componentId, `${label}.componentId`);
      const target = byId.get(componentId);
      if (!target || target.kind === "ground") throw new Error(`${label}: invalid current probe target`);
      return { id, kind: "current", componentId };
    }
    if (p.kind === "voltage") {
      const at = record(p.at, `${label}.at`), componentId = text(at.componentId, `${label}.at.componentId`), target = byId.get(componentId);
      const pin = at.pin as PinName;
      if (!target || (target.kind === "ground" ? pin !== "gnd" : !["a", "b"].includes(pin))) throw new Error(`${label}: invalid voltage probe target`);
      return { id, kind: "voltage", at: { componentId, pin } };
    }
    throw new Error(`${label}: invalid probe kind`);
  });
  const s = record(raw.settings, "settings"), ac = record(s.ac, "settings.ac"), transient = record(s.transient, "settings.transient");
  const startHz = number(ac.startHz, "settings.ac.startHz", 1e-9), stopHz = number(ac.stopHz, "settings.ac.stopHz", 1e-9);
  const points = number(ac.points, "settings.ac.points", 2, 5000);
  const durationSeconds = number(transient.durationSeconds, "settings.transient.durationSeconds", 1e-12);
  const stepSeconds = number(transient.stepSeconds, "settings.transient.stepSeconds", 1e-12);
  if (stopHz <= startHz || !Number.isInteger(points) || durationSeconds / stepSeconds > 5000) throw new Error("Invalid simulation settings range or point limit");
  const settings: AnalysisSettings = { ac: { startHz, stopHz, points }, transient: { durationSeconds, stepSeconds } };
  return { schemaVersion: 1, components, wires, junctions, probes, settings };
}

export function importJSON(text: string): CircuitDocument {
  if (text.length > 2_000_000) throw new Error("Circuit file is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("Circuit file is not valid JSON"); }
  return validateDocument(parsed);
}

export function exportJSON(document: CircuitDocument): string {
  return JSON.stringify(validateDocument(document), null, 2) + "\n";
}
