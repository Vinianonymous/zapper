import type { CircuitDocument } from "../src/model/contracts";
import { emptyDocument } from "../src/model/document";

/** Same size, different matrix sizes: component count alone is not a work bound. */
export function releaseFixture(series = false): CircuitDocument {
  const doc = emptyDocument();
  doc.components.push(
    { id: "v", ref: "V1", kind: "voltageSource", position: { x: 0, y: 0 }, rotation: 0, parameters: { dc: 10, acMagnitude: 1, acPhaseDegrees: 0, transient: { kind: "dc" } } },
    { id: "g", ref: "G1", kind: "ground", position: { x: 2, y: 0 }, rotation: 0, parameters: {} },
  );
  for (let i = 0; i < 198; i++) {
    const x = series ? -4 * (i + 1) : 0;
    const y = series ? 0 : (i + 1) * 4;
    doc.components.push({ id: `r${i}`, ref: `R${i + 1}`, kind: "resistor", position: { x, y }, rotation: 0, parameters: { ohms: 1000 } });
    if (!series) {
      doc.wires.push(
        { id: `a${i}`, points: [{ x: -2, y }, { x: -2, y: y - 4 }] },
        { id: `b${i}`, points: [{ x: 2, y }, { x: 2, y: y - 4 }] },
      );
    }
  }
  if (series) doc.wires.push({ id: "return", points: [{ x: -794, y: 0 }, { x: -794, y: -4 }, { x: 2, y: -4 }, { x: 2, y: 0 }] });
  // Independent decorative segments stress the 500-wire editor cap, not nets.
  while (doc.wires.length < 500) {
    const i = doc.wires.length;
    doc.wires.push({ id: `extra${i}`, points: [{ x: 20, y: i * 2 + 10 }, { x: 21, y: i * 2 + 10 }] });
  }
  doc.probes.push({ id: "pv", kind: "voltage", at: { componentId: "v", pin: "a" } });
  doc.settings.ac.points = 1000;
  return doc;
}
