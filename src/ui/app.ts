import type { AnalysisKind, CircuitDocument, Component, ComponentKind, PinName, Point, Probe, Waveform } from "../model/contracts";
import { emptyDocument, exampleDocument, KIND_LABELS } from "../model/document";
import { GRID, pins, samePoint } from "../model/geometry";
import { formatValue, parseValue } from "../model/values";
import { importCircuit, MAX_FILE_BYTES, serializeCircuit, validateDocument } from "../persistence/json";
import { canExportSchematic, exportSchematic } from "../export/schematic";
import { readDcProbe } from "../probes/dc";
import { schematicBounds, schematicContent } from "../rendering/schematic";
import { AnalysisClient, type AnalysisRunState } from "../simulation/client";
import type { Diagnostic } from "../simulation/diagnostics";
import { validateAnalysisInput } from "../simulation/validation";
import { resolveCircuit } from "../topology/resolve";
import { Workspace } from "../editor/workspace";
import { transientView } from "./transient-chart";
import {
  acIndexAtX, acPlot, acPlotGeometry, AC_COLORS, AC_DASHES, formatPhase, magnitudeDb, type AcSeries,
} from "./ac-chart";
import {
  addJunction, addWire, insertComponent, removeProbe, removeSelection, rotateComponent,
  routeWire, setComponentPosition, toggleCurrentProbe, toggleVoltageProbe, updateComponent,
  type Selection,
} from "../editor/operations";

type Tool = "select" | "wire" | "junction" | "pan" | "voltageProbe" | "currentProbe" | ComponentKind;
type View = { x: number; y: number; width: number; height: number };
const STORAGE_KEY = "circuit-studio-schematic-v1";

const svg = document.querySelector<SVGSVGElement>("#schematic")!;
const inspector = document.querySelector<HTMLDivElement>("#inspector-content")!;
const notice = document.querySelector<HTMLParagraphElement>("#notice")!;
const fileInput = document.querySelector<HTMLInputElement>("#import-file")!;
const toolsHost = document.querySelector<HTMLDivElement>("#tools")!;
const componentsHost = document.querySelector<HTMLDivElement>("#components")!;
const toolHelp = document.querySelector<HTMLSpanElement>("#tool-help")!;
const netList = document.querySelector<HTMLDivElement>("#net-list")!;
const netCount = document.querySelector<HTMLSpanElement>("#net-count")!;
const probeList = document.querySelector<HTMLDivElement>("#probe-list")!;
const undoButton = document.querySelector<HTMLButtonElement>("#undo")!;
const redoButton = document.querySelector<HTMLButtonElement>("#redo")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;
const exportFormat = document.querySelector<HTMLSelectElement>("#export-format")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel")!;
const analysisStatus = document.querySelector<HTMLParagraphElement>("#analysis-status")!;
const diagnosticsList = document.querySelector<HTMLUListElement>("#diagnostics")!;
const probeReadings = document.querySelector<HTMLTableSectionElement>("#probe-readings")!;
const exampleSelect = document.querySelector<HTMLSelectElement>("#example")!;
const analysisKindSelect = document.querySelector<HTMLSelectElement>("#analysis-kind")!;
const settingsHost = document.querySelector<HTMLDivElement>("#analysis-settings")!;
const resultsHost = document.querySelector<HTMLElement>("#results")!;
const dcView = document.querySelector<HTMLDivElement>("#dc-view")!;
const acView = document.querySelector<HTMLDivElement>("#ac-view")!;
const acLegend = document.querySelector<HTMLDivElement>("#ac-legend")!;
const acMagnitude = document.querySelector<HTMLDivElement>("#ac-magnitude")!;
const acPhase = document.querySelector<HTMLDivElement>("#ac-phase")!;
const acReadout = document.querySelector<HTMLParagraphElement>("#ac-readout")!;
const acCursorSample = document.querySelector<HTMLInputElement>("#ac-cursor-sample")!;
const acTableHead = document.querySelector<HTMLTableRowElement>("#ac-table-head")!;
const acTableBody = document.querySelector<HTMLTableSectionElement>("#ac-table-body")!;
const transientHost = document.querySelector<HTMLDivElement>("#transient-view")!;

const toolOptions: { id: Exclude<Tool, ComponentKind>; icon: string; label: string; help: string }[] = [
  { id: "select", icon: "↖", label: "Select / move", help: "Click a part, wire or junction. Drag parts to move." },
  { id: "wire", icon: "⌐", label: "Wire", help: "Click a start point, then an end point. Hold Shift for a vertical-first elbow." },
  { id: "junction", icon: "●", label: "Junction", help: "Click a wire crossing to create an explicit electrical connection." },
  { id: "pan", icon: "✥", label: "Pan", help: "Drag to pan. The middle mouse button pans from any tool." },
  { id: "voltageProbe", icon: "V", label: "Voltage probe", help: "Click a component pin to toggle a voltage probe relative to ground." },
  { id: "currentProbe", icon: "A", label: "Current probe", help: "Click a two-terminal component to toggle a branch-current probe (a → b)." },
];
const componentKinds: ComponentKind[] = ["resistor", "capacitor", "inductor", "voltageSource", "currentSource", "switch", "ground"];
const iconFor: Record<ComponentKind, string> = {
  resistor: "▱", capacitor: "▥", inductor: "⌁", voltageSource: "⊕",
  currentSource: "⊙", switch: "⫽", ground: "⏚",
};

let workspace: Workspace;
let tool: Tool = "select";
let selection: Selection = null;
let view: View;
let wireStart: Point | null = null;
let wirePreview: Point | null = null;
let relatedIds: string[] = [];
let message = "";
let messageKind: "info" | "error" = "info";
let exported = false;
let drag: { startDocument: CircuitDocument; componentId: string; start: Point; origin: Point; moved: boolean } | null = null;
let pan: { clientX: number; clientY: number; view: View } | null = null;
let runState: AnalysisRunState = { status: "idle" };
let diagnostics: Diagnostic[] = [];
let analysisSnapshot: CircuitDocument | undefined;
let acceptedCircuit: ReturnType<typeof resolveCircuit> | undefined;
let preflightFailed = false;
let analysisKind: AnalysisKind = "dc";
let acCursorIndex = 0;
let transientCursorIndex = 0;

const analysis = new AnalysisClient((state) => {
  runState = state;
  if (state.status === "complete" && state.response.type === "failure") {
    diagnostics = [state.response];
    relatedIds = state.response.relatedIds;
    acceptedCircuit = undefined;
  } else if (state.status === "complete" && state.response.type === "success") {
    diagnostics = [];
    relatedIds = [];
    acceptedCircuit = analysisSnapshot ? resolveCircuit(analysisSnapshot) : undefined;
    if (state.response.result.kind === "ac") acCursorIndex = 0;
    if (state.response.result.kind === "transient") transientCursorIndex = 0;
  } else {
    acceptedCircuit = undefined;
  }
  render();
});

function invalidateAnalysis(): void {
  if (runState.status !== "idle") analysis.invalidate();
  diagnostics = [];
  acceptedCircuit = undefined;
  relatedIds = [];
  preflightFailed = false;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeCircuit(workspace.document));
  } catch {
    setMessage("Local auto-save is unavailable. Export a JSON backup.", "error");
  }
}

function setMessage(next: string, kind: "info" | "error" = "info"): void {
  message = next;
  messageKind = kind;
  render();
}

function clearError(): void {
  relatedIds = [];
}

function commit(nextMessage?: string): void {
  clearError();
  if (selection?.type === "component" && !workspace.document.components.some((component) => component.id === selection!.id)) selection = null;
  if (selection?.type === "wire" && !workspace.document.wires.some((wire) => wire.id === selection!.id)) selection = null;
  if (selection?.type === "junction" && !workspace.document.junctions.some((junction) => junction.id === selection!.id)) selection = null;
  invalidateAnalysis();
  exported = false;
  save();
  if (nextMessage) { message = nextMessage; messageKind = "info"; }
  render();
}

function edit(change: (document: CircuitDocument) => void, nextMessage?: string): boolean {
  try {
    workspace.edit(change);
    commit(nextMessage);
    return true;
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "The edit could not be applied.", "error");
    return false;
  }
}

function chooseTool(next: Tool): void {
  tool = next;
  wireStart = null;
  wirePreview = null;
  clearError();
  message = toolHelpText();
  messageKind = "info";
  render();
}

function toolHelpText(): string {
  const option = toolOptions.find((candidate) => candidate.id === tool);
  if (option) return option.help;
  return `Click the grid to place a ${KIND_LABELS[tool as ComponentKind].toLowerCase()}.`;
}

function worldPoint(event: PointerEvent | WheelEvent): Point {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function gridPoint(event: PointerEvent | WheelEvent): Point {
  const point = worldPoint(event);
  return { x: Math.round(point.x / GRID), y: Math.round(point.y / GRID) };
}

function fitView(): void {
  view = schematicBounds(workspace.document);
  renderViewport();
}

function renderViewport(): void {
  // View changes do not alter the document. Avoid rebuilding 200 components,
  // topology, inspector controls and charts on every pan/zoom frame.
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
}

function zoom(factor: number, anchor?: Point): void {
  const center = anchor ?? { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const width = Math.max(90, Math.min(9000, view.width * factor));
  const ratio = width / view.width;
  view = {
    x: center.x - (center.x - view.x) * ratio,
    y: center.y - (center.y - view.y) * ratio,
    width,
    height: view.height * ratio,
  };
  renderViewport();
}

function findPin(target: Element): { componentId: string; pin: PinName } | null {
  const pin = target.closest<SVGElement>("[data-pin][data-owner]");
  return pin ? { componentId: pin.dataset.owner!, pin: pin.dataset.pin as PinName } : null;
}

function findComponent(target: Element): string | null {
  return target.closest<SVGElement>("[data-component]")?.dataset.component ?? null;
}

function toggleProbeAt(target: Element): void {
  if (tool === "voltageProbe") {
    const hit = findPin(target);
    if (!hit) { setMessage("Click a component pin to place a voltage probe.", "error"); return; }
    let added = false;
    try {
      workspace.edit((document) => { added = toggleVoltageProbe(document, hit.componentId, hit.pin); });
      commit(added ? "Voltage probe added." : "Voltage probe removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Probe could not be changed.", "error"); }
    return;
  }
  const id = findComponent(target);
  const component = workspace.document.components.find((item) => item.id === id);
  if (!component || component.kind === "ground") { setMessage("Click a two-terminal component to place a current probe.", "error"); return; }
  let added = false;
  try {
    workspace.edit((document) => { added = toggleCurrentProbe(document, component.id); });
    commit(added ? "Current probe added (positive a → b)." : "Current probe removed.");
  } catch (error) { setMessage(error instanceof Error ? error.message : "Probe could not be changed.", "error"); }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button === 1 || tool === "pan") {
    pan = { clientX: event.clientX, clientY: event.clientY, view: { ...view } };
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (event.button !== 0) return;
  const point = gridPoint(event);

  if (tool === "voltageProbe" || tool === "currentProbe") {
    toggleProbeAt(event.target as Element);
    return;
  }
  if (tool === "wire") {
    if (!wireStart) {
      wireStart = point;
      wirePreview = point;
      render();
    } else {
      const start = wireStart;
      wireStart = null;
      wirePreview = null;
      edit((document) => { addWire(document, start, point, event.shiftKey); }, "Wire added.");
    }
    return;
  }
  if (tool === "junction") {
    let added = false;
    edit((document) => { added = addJunction(document, point); }, added ? "Junction added." : "A junction already exists here.");
    return;
  }
  if (tool !== "select") {
    const kind = tool;
    const added = insertComponentPlaceholder(kind, point);
    if (added) return;
  }

  const pin = findPin(event.target as Element);
  const componentId = pin?.componentId ?? findComponent(event.target as Element);
  const wireId = (event.target as Element).closest<SVGElement>("[data-wire]")?.dataset.wire;
  const junctionId = (event.target as Element).closest<SVGElement>("[data-junction]")?.dataset.junction;

  if (componentId) {
    selection = { type: "component", id: componentId };
    const component = workspace.document.components.find((item) => item.id === componentId);
    if (component) {
      drag = { startDocument: structuredClone(workspace.document), componentId, start: point, origin: { ...component.position }, moved: false };
      svg.setPointerCapture(event.pointerId);
    }
  } else if (junctionId) {
    selection = { type: "junction", id: junctionId };
  } else if (wireId) {
    selection = { type: "wire", id: wireId };
  } else {
    selection = null;
  }
  clearError();
  render();
}

function insertComponentPlaceholder(kind: ComponentKind, point: Point): boolean {
  let id = "";
  const ok = edit((document) => { id = insertComponent(document, kind, point).id; }, `${KIND_LABELS[kind]} placed.`);
  if (ok && id) selection = { type: "component", id };
  chooseTool("select");
  return ok;
}

function onPointerMove(event: PointerEvent): void {
  if (pan) {
    const matrix = svg.getScreenCTM();
    const scale = matrix ? 1 / matrix.a : view.width / Math.max(1, svg.clientWidth);
    view = {
      ...pan.view,
      x: pan.view.x - (event.clientX - pan.clientX) * scale,
      y: pan.view.y - (event.clientY - pan.clientY) * scale,
    };
    renderViewport();
    return;
  }
  if (drag) {
    const point = gridPoint(event);
    const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
    if (!delta.x && !delta.y && !drag.moved) return;
    const next = structuredClone(drag.startDocument);
    setComponentPosition(next, drag.componentId, { x: drag.origin.x + delta.x, y: drag.origin.y + delta.y });
    try {
      validateDocument(next);
      // A preview already changes visible connectivity. Never show old readings
      // or accept an in-flight worker result against the moved circuit.
      if (!drag.moved) invalidateAnalysis();
      workspace.document = next;
      drag.moved = true;
      render();
    } catch { /* Keep the last valid position. */ }
    return;
  }
  if (wireStart) {
    wirePreview = gridPoint(event);
    render();
  }
}

function cancelGesture(): void {
  if (drag) workspace.document = drag.startDocument;
  drag = null;
  pan = null;
  wireStart = null;
  wirePreview = null;
  render();
}

function onPointerUp(event: PointerEvent): void {
  if (pan) {
    pan = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    return;
  }
  if (drag) {
    const finished = drag;
    drag = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (finished.moved) {
      const next = workspace.document;
      workspace.document = finished.startDocument;
      try {
        workspace.replace(next);
        commit("Part moved. Wires stay in place; check the extracted connectivity.");
      } catch (error) {
        workspace.document = finished.startDocument;
        setMessage(error instanceof Error ? error.message : "Move failed.", "error");
      }
    }
  }
}

function appendField(host: HTMLElement, labelText: string, value: string, save: (text: string) => void, type = "text"): void {
  const label = document.createElement("label");
  label.className = "field";
  label.append(document.createTextNode(labelText));
  const input = document.createElement("input");
  input.type = type;
  input.dataset.focusKey = `field:${labelText}`;
  input.value = value;
  input.addEventListener("change", () => {
    const text = input.value;
    // Let the browser finish native Tab/blur focus movement before rebuilding
    // the inspector. Replacing its focused input during change loses Tab order.
    setTimeout(() => {
      try { save(text); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid value.", "error"); }
    }, 0);
  });
  label.append(input);
  host.append(label);
}

function addField(labelText: string, value: string, save: (text: string) => void, type = "text"): void {
  appendField(inspector, labelText, value, save, type);
}

function addAction(labelText: string, action: () => void, secondary = false): void {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = labelText;
  button.dataset.focusKey = `action:${labelText}`;
  if (secondary) button.className = "secondary";
  button.addEventListener("click", action);
  let row = inspector.querySelector<HTMLDivElement>(".inspector-actions");
  if (!row) {
    row = document.createElement("div");
    row.className = "inspector-actions";
    inspector.append(row);
  }
  row.append(button);
}

function componentHeading(component: Component): void {
  const heading = document.createElement("h3");
  heading.textContent = `${component.ref} · ${KIND_LABELS[component.kind]}`;
  const detail = document.createElement("p");
  detail.className = "muted";
  detail.textContent = `Grid ${component.position.x}, ${component.position.y} · ${component.rotation}°`;
  inspector.append(heading, detail);
}

function passiveUnit(component: Component): { key: "ohms" | "farads" | "henrys"; unit: string } | null {
  if (component.kind === "resistor") return { key: "ohms", unit: "Ω" };
  if (component.kind === "capacitor") return { key: "farads", unit: "F" };
  if (component.kind === "inductor") return { key: "henrys", unit: "H" };
  return null;
}

function sourceUnit(component: Component): string {
  return component.kind === "voltageSource" ? "V" : "A";
}

function renderSourceFields(component: Extract<Component, { kind: "voltageSource" | "currentSource" }>): void {
  const id = component.id;
  const unit = sourceUnit(component);
  addField(`DC value (${unit})`, formatValue(component.parameters.dc, unit), (text) => {
    const value = parseValue(text);
    edit((document) => { updateComponent(document, id, (item) => {
      if (item.kind === "voltageSource" || item.kind === "currentSource") item.parameters.dc = value;
    }); });
  });
  addField(`AC magnitude (${unit})`, formatValue(component.parameters.acMagnitude, unit), (text) => {
    const value = parseValue(text);
    if (value < 0) throw new Error("AC magnitude cannot be negative.");
    edit((document) => { updateComponent(document, id, (item) => {
      if (item.kind === "voltageSource" || item.kind === "currentSource") item.parameters.acMagnitude = value;
    }); });
  });
  addField("AC phase (degrees)", String(component.parameters.acPhaseDegrees), (text) => {
    const value = parseValue(text);
    edit((document) => { updateComponent(document, id, (item) => {
      if (item.kind === "voltageSource" || item.kind === "currentSource") item.parameters.acPhaseDegrees = value;
    }); });
  });

  const label = document.createElement("label");
  label.className = "field";
  label.append(document.createTextNode("Transient waveform"));
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Transient waveform");
  for (const kind of ["dc", "sine", "pulse"] as const) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind.toUpperCase();
    select.append(option);
  }
  select.value = component.parameters.transient.kind;
  select.dataset.focusKey = "waveform";
  select.addEventListener("change", () => {
    const transient: Waveform = select.value === "sine"
      ? { kind: "sine", offset: 0, amplitude: 1, frequency: 1000, phaseDegrees: 0 }
      : select.value === "pulse"
        ? { kind: "pulse", low: 0, high: 10, delay: 0, rise: 0, fall: 0, width: 0.001, period: 0.002 }
        : { kind: "dc" };
    edit((document) => { updateComponent(document, id, (item) => {
      if (item.kind === "voltageSource" || item.kind === "currentSource") item.parameters.transient = transient;
    }); }, "Waveform changed.");
  });
  label.append(select);
  inspector.append(label);

  const waveform = component.parameters.transient;
  const waveformHint = document.createElement("p");
  waveformHint.className = "muted";
  waveformHint.textContent = "Transient starts from the separate DC value at t = 0. Sine/pulse then override DC. Pulse width is the high plateau; rise/fall exclude it. Time values accept SI prefixes (for example 1 ms).";
  inspector.append(waveformHint);
  if (waveform.kind === "sine") {
    const fields: [("offset" | "amplitude" | "frequency" | "phaseDegrees"), string][] = [["offset", unit], ["amplitude", unit], ["frequency", "Hz"], ["phaseDegrees", "°"]];
    for (const [key, fieldUnit] of fields) {
      addField(`${key === "phaseDegrees" ? "Phase" : key[0]!.toUpperCase() + key.slice(1)} (${fieldUnit})`, String(waveform[key]), (text) => {
        const value = parseValue(text);
        edit((document) => { updateComponent(document, id, (item) => {
          if (item.kind !== "voltageSource" && item.kind !== "currentSource") return;
          if (item.parameters.transient.kind !== "sine") return;
          (item.parameters.transient as unknown as Record<string, number>)[key] = value;
        }); });
      });
    }
  } else if (waveform.kind === "pulse") {
    const fields: [("low" | "high" | "delay" | "rise" | "fall" | "width" | "period"), string][] = [["low", unit], ["high", unit], ["delay", "s"], ["rise", "s"], ["fall", "s"], ["width", "s"], ["period", "s"]];
    for (const [key, fieldUnit] of fields) {
      addField(`${key[0]!.toUpperCase() + key.slice(1)} (${fieldUnit})`, String(waveform[key]), (text) => {
        const value = parseValue(text);
        edit((document) => { updateComponent(document, id, (item) => {
          if (item.kind !== "voltageSource" && item.kind !== "currentSource") return;
          if (item.parameters.transient.kind !== "pulse") return;
          (item.parameters.transient as unknown as Record<string, number>)[key] = value;
        }); });
      });
    }
  }
}

function renderInspector(): void {
  inspector.replaceChildren();
  if (!selection) {
    const heading = document.createElement("h3");
    heading.textContent = "Nothing selected";
    const text = document.createElement("p");
    text.className = "muted";
    text.textContent = "Click a component, wire or junction to edit it. Colored pin connections are summarized under the canvas.";
    inspector.append(heading, text);
    return;
  }
  if (selection.type === "component") {
    const component = workspace.document.components.find((item) => item.id === selection!.id);
    if (!component) { selection = null; renderInspector(); return; }
    componentHeading(component);
    addField("Reference", component.ref, (text) => {
      const ref = text.trim();
      if (!ref || ref.length > 40) throw new Error("Reference must be 1–40 characters.");
      if (workspace.document.components.some((item) => item.id !== component.id && item.ref === ref)) throw new Error("Reference designators must be unique.");
      edit((document) => { updateComponent(document, component.id, (item) => { item.ref = ref; }); });
    });
    const passive = passiveUnit(component);
    if (passive) {
      const passiveValue = component.kind === "resistor" ? component.parameters.ohms
        : component.kind === "capacitor" ? component.parameters.farads
          : component.kind === "inductor" ? component.parameters.henrys : 0;
      addField(`Value (${passive.unit})`, formatValue(passiveValue, passive.unit), (text) => {
        const value = parseValue(text);
        if (!(value > 0)) throw new Error("Component value must be greater than zero.");
        edit((document) => { updateComponent(document, component.id, (item) => {
          if (item.kind === "resistor") item.parameters.ohms = value;
          if (item.kind === "capacitor") item.parameters.farads = value;
          if (item.kind === "inductor") item.parameters.henrys = value;
        }); });
      });
    }
    if (component.kind === "voltageSource" || component.kind === "currentSource") renderSourceFields(component);
    if (component.kind === "switch") {
      const label = document.createElement("label");
      label.className = "field checkbox";
      label.append(document.createTextNode("Closed"));
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.focusKey = "switch-state";
      input.checked = component.parameters.closed;
      input.addEventListener("change", () => {
        edit((document) => { updateComponent(document, component.id, (item) => {
          if (item.kind === "switch") item.parameters.closed = input.checked;
        }); }, input.checked ? "Switch closed." : "Switch opened.");
      });
      label.append(input);
      inspector.append(label);
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "Ideal model: closed is an exact short (0 Ω); open carries no current. State is fixed during a run. Redundant ideal-source/short loops can be singular; add resistance to model a real switch.";
      inspector.append(hint);
    }
    addField("Grid X", String(component.position.x), (text) => {
      const x = Number(text);
      if (!Number.isInteger(x) || Math.abs(x) > 10000) throw new Error("X must be an integer grid coordinate.");
      edit((document) => { setComponentPosition(document, component.id, { x, y: component.position.y }); }, "Part moved.");
    }, "number");
    addField("Grid Y", String(component.position.y), (text) => {
      const y = Number(text);
      if (!Number.isInteger(y) || Math.abs(y) > 10000) throw new Error("Y must be an integer grid coordinate.");
      edit((document) => { setComponentPosition(document, component.id, { x: component.position.x, y }); }, "Part moved.");
    }, "number");
    addAction("Rotate 90°", () => edit((document) => {
      updateComponent(document, component.id, rotateComponent);
    }, "Part rotated."));
    addAction("Delete", () => deleteSelection());
    if (component.kind !== "ground") {
      const probed = workspace.document.probes.some((probe) => probe.kind === "current" && probe.componentId === component.id);
      addAction(probed ? "Remove current probe" : "Add current probe", () => {
        edit((document) => { toggleCurrentProbe(document, component.id); }, probed ? "Current probe removed." : "Current probe added.");
      }, true);
    }
    return;
  }
  const heading = document.createElement("h3");
  const text = document.createElement("p");
  text.className = "muted";
  if (selection.type === "wire") {
    heading.textContent = "Wire";
    text.textContent = "An orthogonal conductor. Crossings only connect when an explicit junction is placed.";
  } else {
    heading.textContent = "Junction";
    text.textContent = "An explicit electrical connection at a wire crossing.";
  }
  inspector.append(heading, text);
  addAction("Delete", () => deleteSelection());
}

function deleteSelection(): void {
  if (!selection) return;
  const target = selection;
  edit((document) => removeSelection(document, target), "Selection deleted.");
  selection = null;
  render();
}

function probeLabel(probe: Probe): string {
  if (probe.kind === "current") {
    const component = workspace.document.components.find((item) => item.id === probe.componentId);
    return `Current · ${component?.ref ?? "missing"} (a → b)`;
  }
  const component = workspace.document.components.find((item) => item.id === probe.at.componentId);
  return `Voltage · ${component?.ref ?? "missing"}.${probe.at.pin} (to ground)`;
}

function renderProbes(): void {
  probeList.replaceChildren();
  if (!workspace.document.probes.length) {
    const text = document.createElement("p");
    text.className = "muted";
    text.textContent = "No probes selected. Use the V or A probe tools, or a component's inspector.";
    probeList.append(text);
    return;
  }
  for (const probe of workspace.document.probes) {
    const row = document.createElement("div");
    row.className = "probe-row";
    const label = document.createElement("span");
    label.textContent = probeLabel(probe);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.focusKey = `probe:${probe.id}`;
    remove.title = "Remove probe";
    remove.setAttribute("aria-label", `Remove ${probeLabel(probe)}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => edit((document) => removeProbe(document, probe.id), "Probe removed."));
    row.append(label, remove);
    probeList.append(row);
  }
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "Probe selections are saved with the circuit. Run DC for readings or AC for magnitude and phase plots.";
  probeList.append(hint);
}

function analysisLabel(): string {
  return analysisKind === "transient" ? "Transient" : analysisKind === "ac" ? "AC" : "DC";
}

function currentAcResult() {
  const state = runState;
  if (state.status === "complete" && state.response.type === "success" && state.response.result.kind === "ac") {
    return state.response.result;
  }
  return undefined;
}

function currentTransientResult() {
  const state = runState;
  return state.status === "complete" && state.response.type === "success" && state.response.result.kind === "transient"
    ? state.response.result : undefined;
}

function renderTransient(cursorOnly = false): void {
  const html = transientView(workspace.document, currentTransientResult(), transientCursorIndex);
  if (cursorOnly && transientHost.querySelector("#transient-cursor")) {
    // Keep the live range input and expanded table intact while scrubbing.
    const next = document.createElement("div");
    next.innerHTML = html;
    const replacements = next.querySelectorAll(".transient-chart");
    transientHost.querySelectorAll(".transient-chart").forEach((chart, index) => {
      const replacement = replacements[index];
      if (replacement) chart.replaceWith(replacement);
    });
    transientHost.querySelector("#transient-readout")!.textContent = next.querySelector("#transient-readout")!.textContent;
    transientHost.querySelector<HTMLInputElement>("#transient-cursor")!.value = String(transientCursorIndex);
  } else {
    transientHost.innerHTML = html;
  }
}

function acSeriesFor(documentModel: CircuitDocument, result: NonNullable<ReturnType<typeof currentAcResult>>): AcSeries[] {
  return documentModel.probes.map((probe, index) => {
    const data = result.probes[probe.id];
    return {
      probeId: probe.id,
      label: probeLabel(probe),
      unit: probe.kind === "voltage" ? "V" : "A",
      color: AC_COLORS[index % AC_COLORS.length]!,
      magnitude: data?.magnitude ?? [],
      phaseDegrees: data?.phaseDegrees ?? [],
    };
  });
}

function sampleIndices(length: number, maximum: number): number[] {
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  const indices = new Set<number>();
  for (let i = 0; i < maximum; i++) indices.add(Math.round(i * (length - 1) / (maximum - 1)));
  return [...indices].sort((a, b) => a - b);
}

function renderAnalysisSettings(): void {
  settingsHost.replaceChildren();
  if (analysisKind === "transient") {
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = "Backward Euler with DC initialization. At most 100000 steps; matrix/work/sample caps also apply. Use step ≤ RC/100 for accurate RC steps, and at least 100 samples per source period. Coarse steps can miss short pulses and damp RLC ringing.";
    settingsHost.append(hint);
    const step = workspace.document.settings.transient.stepSeconds;
    const coarseSources = workspace.document.components.filter(component => {
      if (component.kind !== "voltageSource" && component.kind !== "currentSource") return false;
      const wave = component.parameters.transient;
      return wave.kind === "sine" ? step * wave.frequency > .01 : wave.kind === "pulse" &&
        (step > wave.period / 100 || (wave.width > 0 && step > wave.width / 10) || (wave.rise > 0 && step > wave.rise / 10) || (wave.fall > 0 && step > wave.fall / 10));
    });
    if (coarseSources.length) {
      const warning = document.createElement("p");
      warning.className = "time-step-warning";
      warning.textContent = `Warning: the time step may under-resolve ${coarseSources.map(c => c.ref).join(", ")}. Reduce it for waveform periods or edge times.`;
      settingsHost.append(warning);
    }
    for (const [key, label] of [["durationSeconds", "Duration (s)"], ["stepSeconds", "Time step (s)"]] as const) {
      appendField(settingsHost, label, String(workspace.document.settings.transient[key]), text => {
        const value = parseValue(text);
        if (!(Number.isFinite(value) && value > 0)) throw new Error(`${label} must be finite and greater than zero.`);
        edit(document => { document.settings.transient[key] = value; }, "Transient settings updated.");
      });
    }
    return;
  }
  if (analysisKind === "dc") {
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = "DC uses each source's DC value. AC magnitude and phase are used only by AC sweeps.";
    settingsHost.append(hint);
    return;
  }
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "Logarithmic sweep from start to stop, inclusive. Points are spaced evenly in log₁₀(f).";
  settingsHost.append(hint);
  const { startHz, stopHz, points } = workspace.document.settings.ac;
  appendField(settingsHost, "Start (Hz)", String(startHz), (text) => {
    const value = parseValue(text);
    if (!(Number.isFinite(value) && value > 0)) throw new Error("AC start frequency must be finite and greater than zero.");
    if (!(workspace.document.settings.ac.stopHz > value)) throw new Error("AC start frequency must be below the stop frequency.");
    edit((document) => { document.settings.ac.startHz = value; }, "AC start frequency updated.");
  });
  appendField(settingsHost, "Stop (Hz)", String(stopHz), (text) => {
    const value = parseValue(text);
    if (!(Number.isFinite(value) && value > startHz)) throw new Error("AC stop frequency must be finite and greater than the start frequency.");
    edit((document) => { document.settings.ac.stopHz = value; }, "AC stop frequency updated.");
  });
  appendField(settingsHost, "Points", String(points), (text) => {
    const value = Number(text);
    if (!Number.isInteger(value) || value < 2 || value > 10_000) throw new Error("AC sweep points must be an integer from 2 to 10000.");
    edit((document) => { document.settings.ac.points = value; }, "AC point count updated.");
  }, "number");
}

function renderAcLegend(series: AcSeries[]): void {
  acLegend.replaceChildren();
  if (!series.length) {
    const text = document.createElement("p");
    text.className = "muted";
    text.textContent = "No probes are selected. Add V or A probes to plot a response.";
    acLegend.append(text);
    return;
  }
  for (const [index, entry] of series.entries()) {
    const item = document.createElement("span");
    item.className = "ac-legend-item";
    const swatch = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    swatch.setAttribute("class", "ac-swatch");
    swatch.setAttribute("viewBox", "0 0 32 12");
    swatch.setAttribute("aria-hidden", "true");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("x2", "32");
    line.setAttribute("y1", "6");
    line.setAttribute("y2", "6");
    line.setAttribute("stroke", entry.color);
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", AC_DASHES[index % AC_DASHES.length]!);
    swatch.append(line);
    const label = document.createElement("span");
    label.textContent = `${entry.label} (${entry.unit})`;
    item.append(swatch, label);
    acLegend.append(item);
  }
}

const AC_EMPTY = "Run an AC sweep to plot magnitude and phase.";

function renderAcCharts(): void {
  const result = currentAcResult();
  if (!result || !result.frequenciesHz.length) {
    acMagnitude.innerHTML = `<p class="muted ac-empty">${AC_EMPTY}</p>`;
    acPhase.innerHTML = "";
    return;
  }
  const series = acSeriesFor(workspace.document, result);
  acCursorIndex = Math.min(Math.max(0, acCursorIndex), result.frequenciesHz.length - 1);
  if (!series.length) {
    acMagnitude.innerHTML = '<p class="muted ac-empty">Run AC after adding at least one V or A probe.</p>';
    acPhase.innerHTML = "";
    return;
  }
  acMagnitude.innerHTML = acPlot(result.frequenciesHz, series, "magnitude", acCursorIndex).svg;
  acPhase.innerHTML = acPlot(result.frequenciesHz, series, "phase", acCursorIndex).svg;
}

function renderAcReadout(): void {
  const result = currentAcResult();
  acCursorSample.disabled = !result?.frequenciesHz.length;
  acCursorSample.max = String(Math.max(0, (result?.frequenciesHz.length ?? 1) - 1));
  acCursorSample.value = String(acCursorIndex);
  if (!result || !result.frequenciesHz.length) {
    acReadout.textContent = "Run an AC sweep to read probe values.";
    return;
  }
  const series = acSeriesFor(workspace.document, result);
  const frequency = result.frequenciesHz[acCursorIndex];
  if (frequency === undefined) {
    acReadout.textContent = "No cursor sample is available.";
    return;
  }
  if (!series.length) {
    acReadout.textContent = `${formatValue(frequency, "Hz")} · no probes selected.`;
    return;
  }
  const readings = series.map((entry) => {
    const value = entry.magnitude[acCursorIndex];
    const phase = entry.phaseDegrees[acCursorIndex];
    if (value === undefined || phase === undefined) return `${entry.label}: unavailable`;
    return `${entry.label}: ${formatValue(value, entry.unit)} (${magnitudeDb(value).toFixed(1)} dB), ${formatPhase(phase)}`;
  });
  acReadout.textContent = `${formatValue(frequency, "Hz")} · ${readings.join(" · ")}`;
}

function renderAcTable(): void {
  const result = currentAcResult();
  const series = result ? acSeriesFor(workspace.document, result) : [];
  acTableHead.replaceChildren();
  const frequencyHeader = document.createElement("th");
  frequencyHeader.scope = "col";
  frequencyHeader.textContent = "Frequency";
  acTableHead.append(frequencyHeader);
  for (const entry of series) {
    const magnitudeHeader = document.createElement("th");
    magnitudeHeader.scope = "col";
    magnitudeHeader.textContent = `${entry.label} (${entry.unit})`;
    const phaseHeader = document.createElement("th");
    phaseHeader.scope = "col";
    phaseHeader.textContent = `${entry.label} phase`;
    acTableHead.append(magnitudeHeader, phaseHeader);
  }

  acTableBody.replaceChildren();
  const messageRow = (text: string): void => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = Math.max(1, acTableHead.children.length);
    cell.textContent = text;
    row.append(cell);
    acTableBody.append(row);
  };
  if (!result || !result.frequenciesHz.length) { messageRow("No simulation has been run."); return; }
  if (!series.length) { messageRow("No probes selected. Add V or A probes, then run AC again."); return; }

  for (const index of sampleIndices(result.frequenciesHz.length, 21)) {
    const row = document.createElement("tr");
    const frequency = document.createElement("td");
    frequency.textContent = formatValue(result.frequenciesHz[index]!, "Hz");
    row.append(frequency);
    for (const entry of series) {
      const magnitudeCell = document.createElement("td");
      const magnitudeValue = entry.magnitude[index];
      magnitudeCell.textContent = magnitudeValue === undefined
        ? "Unavailable"
        : `${formatValue(magnitudeValue, entry.unit)} (${magnitudeDb(magnitudeValue).toFixed(1)} dB)`;
      const phaseCell = document.createElement("td");
      const phaseValue = entry.phaseDegrees[index];
      phaseCell.textContent = phaseValue === undefined ? "Unavailable" : formatPhase(phaseValue);
      row.append(magnitudeCell, phaseCell);
    }
    acTableBody.append(row);
  }
}

function renderAcView(): void {
  const result = currentAcResult();
  renderAcLegend(result ? acSeriesFor(workspace.document, result) : []);
  renderAcCharts();
  renderAcReadout();
  renderAcTable();
}

function renderAnalysis(): void {
  const running = runState.status === "running";
  runButton.disabled = running || !workspace.document.components.length;
  cancelButton.disabled = !running;
  runButton.textContent = `Run ${analysisLabel()}`;
  dcView.hidden = analysisKind !== "dc";
  acView.hidden = analysisKind !== "ac";
  transientHost.hidden = analysisKind !== "transient";
  resultsHost.classList.toggle("ac-mode", analysisKind !== "dc");
  renderAnalysisSettings();
  if (analysisKind === "ac") renderAcView();
  if (analysisKind === "transient") renderTransient();

  const label = analysisLabel();
  let status: string;
  let statusKind: "info" | "error" = "info";
  switch (runState.status) {
    case "idle":
      status = preflightFailed ? `${label} preflight failed. Fix the diagnostics below.` : `No ${label} simulation has been run.`;
      statusKind = preflightFailed ? "error" : "info";
      break;
    case "running":
      status = `Running ${label} in a Web Worker… You can inspect the circuit or cancel.`;
      break;
    case "stale":
      status = `Results are stale after a circuit or settings edit. Run ${label} again.`;
      break;
    case "cancelled":
      status = `${label} run cancelled. No current results.`;
      statusKind = "error";
      break;
    case "complete":
      if (runState.response.type === "success") {
        if (runState.response.result.kind === "ac") {
          const count = runState.response.result.frequenciesHz.length;
          const probeCount = Object.keys(runState.response.result.probes).length;
          status = probeCount
            ? `AC sweep solved successfully (${count} frequencies, ${probeCount} probes).`
            : `AC sweep solved successfully (${count} frequencies). Add probes to plot values.`;
        } else if (runState.response.result.kind === "transient") {
          status = `Transient solved successfully (${runState.response.result.timesSeconds.length} time samples).`;
        } else {
          status = "DC operating point solved successfully.";
        }
      } else {
        status = `${label} failed: ${runState.response.message}`;
        statusKind = "error";
      }
      break;
  }
  analysisStatus.textContent = status;
  analysisStatus.dataset.kind = statusKind;
  diagnosticsList.replaceChildren();
  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");
    item.textContent = `${diagnostic.code}: ${diagnostic.message}`;
    if (diagnostic.relatedIds.length) {
      const select = document.createElement("button");
      select.type = "button";
      select.textContent = "Select related part";
      select.addEventListener("click", () => {
        selection = { type: "component", id: diagnostic.relatedIds[0]! };
        render();
      });
      item.append(" ", select);
    }
    diagnosticsList.append(item);
  }

  probeReadings.replaceChildren();
  const result = runState.status === "complete" && runState.response.type === "success" && runState.response.result.kind === "dc"
    ? runState.response.result : undefined;
  if (!workspace.document.probes.length) {
    probeReadings.innerHTML = '<tr><td colspan="3">No probes selected. Use the V or A probe tools, or the inspector.</td></tr>';
    return;
  }
  for (const probe of workspace.document.probes) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = probeLabel(probe);
    const value = document.createElement("td");
    const reading = acceptedCircuit && result ? readDcProbe(probe, acceptedCircuit, result) : undefined;
    value.textContent = reading ? reading.value === null ? "Unavailable" : formatValue(reading.value, reading.unit) : "— run DC";
    const reference = document.createElement("td");
    reference.textContent = probe.kind === "voltage" ? "Relative to ground" : "Positive pin a → b";
    row.append(name, value, reference);
    probeReadings.append(row);
  }
}

const NET_COLORS = ["#6ee7b7", "#80c9ff", "#f9c974", "#d7b2ff", "#ff9faf", "#7dd3fc", "#b9d779"];
function renderConnectivity(): void {
  netList.replaceChildren();
  const resolved = resolveCircuit(workspace.document);
  const groups = new Map<number, string[]>();
  for (const component of workspace.document.components) {
    for (const pin of pins(component)) {
      const node = resolved.nodeByPin[`${component.id}:${pin.name}`];
      if (node === undefined) continue;
      groups.set(node, [...(groups.get(node) ?? []), `${component.ref}.${pin.name}`]);
    }
  }
  const hasGround = workspace.document.components.some((component) => component.kind === "ground");
  netCount.textContent = workspace.document.components.length
    ? `· ${groups.size} ${groups.size === 1 ? "net" : "nets"}${hasGround ? " including ground" : " · no ground reference"}`
    : "";
  if (!groups.size) {
    const text = document.createElement("span");
    text.className = "muted";
    text.textContent = "No components yet. Place a part to start.";
    netList.append(text);
    return;
  }
  for (const [node, labels] of [...groups].sort((a, b) => a[0] - b[0])) {
    const tag = document.createElement("span");
    tag.className = "net-tag";
    const title = document.createElement("b");
    title.textContent = node === 0 ? "GND" : `N${node}`;
    title.style.color = NET_COLORS[node % NET_COLORS.length]!;
    tag.append(title, document.createTextNode(labels.join(" · ")));
    if (labels.length === 1) {
      tag.classList.add("unconnected");
      tag.title = "Only one pin is on this net — it is not connected to anything else.";
    }
    netList.append(tag);
  }
}

function renderPreview(): void {
  if (!wireStart || !wirePreview) return;
  const points = routeWire(wireStart, wirePreview);
  if (points.length < 2) return;
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", points.map((point) => `${point.x * GRID},${point.y * GRID}`).join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#f9c974");
  polyline.setAttribute("stroke-width", "2");
  polyline.setAttribute("stroke-dasharray", "6 4");
  polyline.setAttribute("pointer-events", "none");
  svg.append(polyline);
}

function render(): void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusKey = focused?.dataset.focusKey;
  const focusHost = focused?.closest<HTMLElement>("#inspector-content, #analysis-settings, #probe-list");
  const draft = focused instanceof HTMLInputElement ? focused.value : undefined;
  const documentModel = workspace.document;
  svg.dataset.tool = tool;
  renderViewport();
  svg.innerHTML = schematicContent(documentModel, {
    interactive: true,
    selectedId: selection?.id,
    relatedIds,
  });
  renderPreview();
  renderInspector();
  renderProbes();
  renderConnectivity();
  renderAnalysis();

  undoButton.disabled = !workspace.canUndo;
  redoButton.disabled = !workspace.canRedo;
  exportButton.disabled = !canExportSchematic(documentModel);
  exportButton.title = canExportSchematic(documentModel) ? "Export the current schematic; no simulation required" : "There is no schematic to export";
  toolHelp.textContent = toolOptions.find((option) => option.id === tool)?.help ?? "Click the grid to place the selected part.";
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("#tools [data-tool], #components [data-component]"))) {
    const active = (button.dataset.tool ?? button.dataset.component) === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  notice.textContent = message || "Auto-saved locally · Run DC, AC or transient to calculate, then inspect probes, plots or export the schematic.";
  notice.dataset.kind = messageKind;
  if (focusKey && focusHost && focused && !focused.isConnected) {
    const replacement = Array.from(focusHost.querySelectorAll<HTMLElement>("[data-focus-key]"))
      .find((element) => element.dataset.focusKey === focusKey);
    if (replacement instanceof HTMLInputElement && draft !== undefined) replacement.value = draft;
    (replacement ?? svg).focus({ preventScroll: true });
  }
}

function buildPalette(): void {
  for (const option of toolOptions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tool = option.id;
    button.title = option.help;
    button.setAttribute("aria-label", option.label);
    const icon = document.createElement("span");
    icon.className = "tool-icon";
    icon.textContent = option.icon;
    const label = document.createElement("span");
    label.textContent = option.label;
    button.append(icon, label);
    button.addEventListener("click", () => chooseTool(option.id));
    toolsHost.append(button);
  }
  for (const kind of componentKinds) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.component = kind;
    button.title = `Place a ${KIND_LABELS[kind].toLowerCase()}`;
    button.setAttribute("aria-label", KIND_LABELS[kind]);
    const icon = document.createElement("span");
    icon.className = "tool-icon";
    icon.textContent = iconFor[kind];
    const label = document.createElement("span");
    label.textContent = KIND_LABELS[kind];
    button.append(icon, label);
    button.addEventListener("click", () => chooseTool(kind));
    componentsHost.append(button);
  }
}

function confirmReplace(): boolean {
  const documentModel = workspace.document;
  if (!canExportSchematic(documentModel)) return true;
  return window.confirm("Replace the open circuit? Export a JSON backup first if you need it.");
}

function replaceDocument(next: CircuitDocument, nextMessage: string): void {
  try {
    workspace.replace(next);
    drag = null;
    pan = null;
    wireStart = null;
    wirePreview = null;
    selection = null;
    exported = false;
    invalidateAnalysis();
    save();
    view = schematicBounds(workspace.document);
    message = nextMessage;
    messageKind = "info";
    render();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "The circuit could not be loaded.", "error");
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindActions(): void {
  document.querySelector("#new")!.addEventListener("click", () => {
    if (confirmReplace()) replaceDocument(emptyDocument(), "New blank circuit. Auto-saved locally.");
  });
  document.querySelector("#load-example")!.addEventListener("click", () => {
    if (!confirmReplace()) return;
    const name = exampleSelect.value;
    analysisKind = name === "rlc" ? "transient" : name === "rc" ? "ac" : "dc";
    analysisKindSelect.value = analysisKind;
    replaceDocument(
      exampleDocument(name),
      name === "rlc" ? "RLC pulse response loaded. Run Transient to inspect damped ringing after the pulse edge." : name === "rc"
        ? "RC low-pass loaded. Run AC to sweep 10 Hz–100 kHz and inspect the −3 dB point."
        : "Example loaded. Run DC to inspect its operating point.",
    );
  });
  analysisKindSelect.addEventListener("change", () => {
    analysisKind = analysisKindSelect.value === "transient" ? "transient" : analysisKindSelect.value === "ac" ? "ac" : "dc";
    acCursorIndex = 0;
    invalidateAnalysis();
    render();
  });
  document.querySelector("#fit")!.addEventListener("click", fitView);
  document.querySelector("#zoom-in")!.addEventListener("click", () => zoom(0.8));
  document.querySelector("#zoom-out")!.addEventListener("click", () => zoom(1.25));
  undoButton.addEventListener("click", () => { workspace.undo(); commit("Undo."); });
  redoButton.addEventListener("click", () => { workspace.redo(); commit("Redo."); });
  document.querySelector("#import")!.addEventListener("click", () => { fileInput.value = ""; fileInput.click(); });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("Circuit file exceeds the 1 MB limit.");
      const incoming = importCircuit(await file.text());
      if (!confirmReplace()) return;
      replaceDocument(incoming, "Circuit imported. Check connectivity below the canvas.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.", "error");
    }
  });
  exportButton.addEventListener("click", async () => {
    const format = exportFormat.value as "json" | "svg" | "png";
    const documentModel = structuredClone(workspace.document);
    exportButton.disabled = true;
    try {
      const blob = format === "json"
        ? new Blob([serializeCircuit(documentModel)], { type: "application/json" })
        : await exportSchematic(documentModel, format);
      download(blob, `circuit.${format}`);
      exported = format === "json";
      setMessage(format === "json" ? "Circuit JSON exported as circuit.json." : `${format.toUpperCase()} schematic exported as circuit.${format}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.", "error");
    } finally {
      render();
    }
  });
  runButton.addEventListener("click", () => {
    const kind = analysisKind;
    diagnostics = validateAnalysisInput(workspace.document, kind);
    preflightFailed = diagnostics.length > 0;
    relatedIds = diagnostics.flatMap((diagnostic) => diagnostic.relatedIds);
    acceptedCircuit = undefined;
    if (preflightFailed) {
      runState = { status: "idle" };
      render();
      return;
    }
    if (kind === "ac") acCursorIndex = 0;
    analysisSnapshot = structuredClone(workspace.document);
    analysis.run(analysisSnapshot, kind);
  });
  cancelButton.addEventListener("click", () => analysis.cancel());
  window.addEventListener("pagehide", () => analysis.dispose());
  transientHost.addEventListener("input", event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== "transient-cursor") return;
    transientCursorIndex = Number(input.value);
    renderTransient(true);
  });
  transientHost.addEventListener("pointermove", event => {
    const target = event.target as Element;
    const plot = target.closest("svg");
    const matrix = plot?.getScreenCTM();
    const result = currentTransientResult();
    if (!plot?.closest(".transient-chart") || !matrix || !result) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const time = Math.max(0, Math.min(1, (point.x - 68) / 816)) * result.timesSeconds.at(-1)!;
    let index = 0;
    for (let i = 1; i < result.timesSeconds.length; i++) {
      if (Math.abs(result.timesSeconds[i]! - time) < Math.abs(result.timesSeconds[index]! - time)) index = i;
    }
    if (index === transientCursorIndex) return;
    transientCursorIndex = index;
    renderTransient(true);
  });
  acCursorSample.addEventListener("input", () => {
    acCursorIndex = Number(acCursorSample.value);
    renderAcCharts();
    renderAcReadout();
  });
  for (const chart of [acMagnitude, acPhase]) {
    chart.addEventListener("pointermove", (event) => {
      const result = currentAcResult();
      const plot = chart.querySelector("svg");
      const matrix = plot?.getScreenCTM();
      if (!result || !matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const index = acIndexAtX(acPlotGeometry(result.frequenciesHz), result.frequenciesHz, point.x);
      if (index === acCursorIndex) return;
      acCursorIndex = index;
      renderAcCharts();
      renderAcReadout();
    });
  }

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", cancelGesture);
  svg.addEventListener("contextmenu", (event) => event.preventDefault());
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.85 : 1.18, worldPoint(event));
  }, { passive: false });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? workspace.redo() : workspace.undo();
      commit(event.shiftKey ? "Redo." : "Undo.");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      workspace.redo();
      commit("Redo.");
      return;
    }
    if (event.key === "Escape") {
      cancelGesture();
      chooseTool("select");
      selection = null;
      wireStart = null;
      render();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selection) {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (event.key.toLowerCase() === "r" && selection?.type === "component") {
      const id = selection.id;
      edit((document) => { updateComponent(document, id, rotateComponent); }, "Part rotated.");
    }
  });
}

function start(): void {
  let initial: CircuitDocument;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    initial = saved ? validateDocument(JSON.parse(saved)) : exampleDocument("divider");
  } catch {
    initial = exampleDocument("divider");
    message = "The stored workspace was invalid; loaded the starter circuit instead.";
    messageKind = "error";
  }
  workspace = new Workspace(structuredClone(initial));
  buildPalette();
  view = schematicBounds(workspace.document);
  bindActions();
  save();
  render();
  if (!exported) exported = false;
}

start();
