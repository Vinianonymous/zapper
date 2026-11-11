import type { AnalysisKind, CircuitDocument } from "../model/contracts";
import type { Diagnostic } from "./diagnostics";
import { validateDocument } from "../persistence/json";

/**
 * Structural preflight runs both before dispatch and within the worker.
 * Topology-dependent checks (unconnected pins, floating nets, contradictory
 * ideal sources) run inside the solver on the resolved snapshot.
 */
export function validateAnalysisInput(document: CircuitDocument, kind: AnalysisKind): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  try { validateDocument(document); } catch (error) {
    return [{ code: "invalid-input", message: error instanceof Error ? error.message : "Invalid circuit document.", relatedIds: [] }];
  }
  if (document.components.length === 0) {
    diagnostics.push({
      code: "invalid-input",
      message: `Place components and connect a circuit before running ${kind === "dc" ? "DC" : kind === "ac" ? "an AC sweep" : "transient analysis"}.`,
      relatedIds: [],
    });
  } else if (!document.components.some((component) => component.kind === "ground")) {
    diagnostics.push({ code: "missing-ground", message: "Add a ground reference and connect it to the circuit return path.", relatedIds: [] });
  }
  for (const component of document.components) {
    let value: number | undefined;
    switch (component.kind) {
      case "resistor": value = component.parameters.ohms; break;
      case "capacitor": value = component.parameters.farads; break;
      case "inductor": value = component.parameters.henrys; break;
      case "voltageSource":
      case "currentSource":
        if (!Number.isFinite(component.parameters.dc)) {
          diagnostics.push({ code: "invalid-input", message: `${component.ref}: enter a finite DC source value.`, relatedIds: [component.id] });
        }
        if (kind === "ac") {
          if (!Number.isFinite(component.parameters.acMagnitude) || component.parameters.acMagnitude < 0) {
            diagnostics.push({ code: "invalid-input", message: `${component.ref}: AC magnitude must be finite and nonnegative.`, relatedIds: [component.id] });
          }
          if (!Number.isFinite(component.parameters.acPhaseDegrees)) {
            diagnostics.push({ code: "invalid-input", message: `${component.ref}: AC phase must be finite.`, relatedIds: [component.id] });
          }
        }
        break;
    }
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      diagnostics.push({ code: "invalid-input", message: `${component.ref}: enter a finite, positive component value.`, relatedIds: [component.id] });
    }
  }
  if (kind === "ac") {
    const { startHz, stopHz, points } = document.settings.ac;
    if (!(Number.isFinite(startHz) && startHz > 0) || !(Number.isFinite(stopHz) && stopHz > startHz)) {
      diagnostics.push({ code: "invalid-input", message: "AC sweep needs positive start and stop frequencies with stop greater than start.", relatedIds: [] });
    }
    if (!Number.isInteger(points) || points < 2 || points > 10000) {
      diagnostics.push({ code: "invalid-input", message: "AC sweep needs an integer point count from 2 to 10000.", relatedIds: [] });
    }
  }
  return diagnostics;
}

export function validateDcInput(document: CircuitDocument): Diagnostic[] {
  return validateAnalysisInput(document, "dc");
}

export function validateAcInput(document: CircuitDocument): Diagnostic[] {
  return validateAnalysisInput(document, "ac");
}
