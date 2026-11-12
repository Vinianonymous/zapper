import type { CircuitDocument } from "../model/contracts";
import { pins, samePoint } from "../model/geometry";

export const MAX_FILE_BYTES = 1_000_000;
export const LIMITS = { components: 200, wires: 500, junctions: 500, probes: 1000, points: 2000 };

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown, label: string): Record<string, unknown> {
  require(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, fields: string[], label: string): void {
  require(Object.keys(value).every((key) => fields.includes(key)) && fields.every((key) => Object.hasOwn(value, key)), `${label} has missing or unsupported fields.`);
}
function number(value: unknown, label: string, min = -1e9, max = 1e9): asserts value is number {
  require(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max, `${label} must be finite and between ${min} and ${max}.`);
}
function point(value: unknown): void {
  const p = object(value, "Position"); keys(p, ["x", "y"], "Position");
  for (const axis of ["x", "y"]) { number(p[axis], "Coordinate", -10000, 10000); require(Number.isInteger(p[axis]), "Coordinates must use integer grid units."); }
}
function array(value: unknown, name: string, max: number): unknown[] {
  require(Array.isArray(value) && value.length <= max, `${name} must be an array with at most ${max} entries.`);
  return value;
}

/** Full structural validation at import, restore and worker boundaries. No mutation on failure. */
export function validateDocument(value: unknown): CircuitDocument {
  const doc = object(value, "Circuit");
  require(doc.schemaVersion === 1, "Unsupported circuit schema version. Expected version 1.");
  keys(doc, ["schemaVersion", "components", "wires", "junctions", "probes", "settings"], "Circuit");
  const ids = new Set<string>();
  const id = (value: unknown): void => {
    require(typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) && !ids.has(value), "IDs must be unique, 1–80 letters, numbers, underscores or hyphens.");
    ids.add(value);
  };
  const refs = new Set<string>();
  const components = array(doc.components, "Components", LIMITS.components);
  for (const value of components) {
    const c = object(value, "Component"); keys(c, ["id", "kind", "ref", "position", "rotation", "parameters"], "Component");
    id(c.id); point(c.position);
    require(typeof c.ref === "string" && c.ref.trim().length > 0 && c.ref.length <= 40 && !refs.has(c.ref), "References must be nonempty, unique and at most 40 characters.");
    refs.add(c.ref);
    require([0, 90, 180, 270].includes(c.rotation as number), "Rotation must be 0, 90, 180 or 270 degrees.");
    const p = object(c.parameters, "Parameters");
    switch (c.kind) {
      case "resistor":
      case "variableResistor":
      case "lamp": keys(p, ["ohms"], "Resistive part"); number(p.ohms, "Resistance (Ω)", 1e-6, 1e12); break;
      case "capacitor": keys(p, ["farads"], "Capacitor"); number(p.farads, "Capacitance (F)", 1e-15, 1e3); break;
      case "inductor": keys(p, ["henrys"], "Inductor"); number(p.henrys, "Inductance (H)", 1e-15, 1e6); break;
      case "switch": keys(p, ["closed"], "Switch"); require(typeof p.closed === "boolean", "Switch state must be Boolean."); break;
      case "ground": keys(p, [], "Ground"); break;
      case "voltageSource":
      case "currentSource": {
        keys(p, ["dc", "acMagnitude", "acPhaseDegrees", "transient"], "Source");
        number(p.dc, "DC source", -1e9, 1e9); number(p.acMagnitude, "AC magnitude", 0, 1e9); number(p.acPhaseDegrees, "AC phase");
        const wave = object(p.transient, "Waveform");
        if (wave.kind === "dc") keys(wave, ["kind"], "DC waveform");
        else if (wave.kind === "sine") {
          keys(wave, ["kind", "offset", "amplitude", "frequency", "phaseDegrees"], "Sine waveform");
          number(wave.offset, "Offset"); number(wave.amplitude, "Amplitude", 0); number(wave.frequency, "Frequency", 1e-9); number(wave.phaseDegrees, "Phase");
        } else if (wave.kind === "pulse") {
          keys(wave, ["kind", "low", "high", "delay", "rise", "fall", "width", "period"], "Pulse waveform");
          number(wave.low, "Low"); number(wave.high, "High");
          for (const key of ["delay", "rise", "fall", "width"]) number(wave[key], key, 0);
          number(wave.period, "Period", 1e-12);
          require((wave.width as number) + (wave.rise as number) + (wave.fall as number) <= wave.period, "Pulse width, rise and fall must fit the period.");
        } else throw new Error("Unsupported source waveform.");
        break;
      }
      default: throw new Error("Unsupported component kind. Only linear v1 components can be imported.");
    }
  }
  let pointCount = 0;
  for (const value of array(doc.wires, "Wires", LIMITS.wires)) {
    const wire = object(value, "Wire"); keys(wire, ["id", "points"], "Wire"); id(wire.id);
    const points = array(wire.points, "Wire points", LIMITS.points); require(points.length >= 2, "A wire needs at least two points.");
    pointCount += points.length; require(pointCount <= LIMITS.points, "Too many total wire points (maximum 2000).");
    points.forEach(point);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as { x: number; y: number }; const b = points[i] as typeof a;
      require(!samePoint(a, b) && (a.x === b.x || a.y === b.y), "Wire segments must be orthogonal and nonzero length.");
    }
  }
  for (const value of array(doc.junctions, "Junctions", LIMITS.junctions)) {
    const j = object(value, "Junction"); keys(j, ["id", "position"], "Junction"); id(j.id); point(j.position);
  }
  const typed = value as CircuitDocument;
  for (const value of array(doc.probes, "Probes", LIMITS.probes)) {
    const p = object(value, "Probe"); id(p.id);
    if (p.kind === "voltage") {
      keys(p, ["id", "kind", "at"], "Voltage probe"); const at = object(p.at, "Probe pin"); keys(at, ["componentId", "pin"], "Probe pin");
      const c = typed.components.find((c) => c.id === at.componentId);
      require(c && pins(c).some((pin) => pin.name === at.pin), "Voltage probe points to a missing component or pin.");
    } else if (p.kind === "current") {
      keys(p, ["id", "kind", "componentId"], "Current probe");
      require(typed.components.some((c) => c.id === p.componentId && c.kind !== "ground"), "Current probe must reference a two-pin component.");
    } else throw new Error("Unsupported probe kind.");
  }
  const settings = object(doc.settings, "Settings"); keys(settings, ["ac", "transient"], "Settings");
  const ac = object(settings.ac, "AC settings"); keys(ac, ["startHz", "stopHz", "points"], "AC settings");
  number(ac.startHz, "Start frequency", 1e-9, 1e12); number(ac.stopHz, "Stop frequency", 1e-9, 1e12);
  require(ac.startHz < ac.stopHz, "AC stop frequency must exceed start frequency.");
  number(ac.points, "AC points", 2, 10000); require(Number.isInteger(ac.points), "AC points must be an integer.");
  const tr = object(settings.transient, "Transient settings"); keys(tr, ["durationSeconds", "stepSeconds"], "Transient settings");
  number(tr.durationSeconds, "Duration", 1e-12, 1e6); number(tr.stepSeconds, "Time step", 1e-12, 1e6);
  require(tr.stepSeconds <= tr.durationSeconds && tr.durationSeconds / tr.stepSeconds <= 100000, "Time step must fit duration and at most 100000 steps.");
  return structuredClone(typed);
}

export function importCircuit(text: string): CircuitDocument {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error("Circuit file exceeds the 1 MB limit.");
  return validateDocument(JSON.parse(text));
}

export function serializeCircuit(document: CircuitDocument): string {
  return JSON.stringify(validateDocument(document), null, 2);
}
