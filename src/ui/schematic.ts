import type { CircuitDocument, Component, Point, ResolvedCircuit } from "../model/contracts";
import { key, onSegment, pinPosition, pins } from "../model/editor";
import { formatValue } from "../model/values";

const NS = "http://www.w3.org/2000/svg";
export type Selection = { type: "component" | "wire" | "junction"; id: string } | null;
export type View = { x: number; y: number; width: number; height: number };
const colors = ["#6ee7b7", "#80c9ff", "#f9c974", "#d7b2ff", "#ff9faf", "#8fe2dc", "#b9d779"];
export const netColor = (node: number | undefined): string => node === undefined ? "#8291a9" : colors[node % colors.length]!;

function element(tag: string, attrs: Record<string, string | number> = {}, text?: string): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function line(parent: SVGElement, x1: number, y1: number, x2: number, y2: number): void {
  parent.append(element("line", { x1, y1, x2, y2 }));
}

function value(component: Component): string {
  switch (component.kind) {
    case "resistor":
    case "variableResistor":
    case "lamp": return formatValue(component.parameters.ohms, "Ω");
    case "capacitor": return formatValue(component.parameters.farads, "F");
    case "inductor": return formatValue(component.parameters.henrys, "H");
    case "voltageSource": return formatValue(component.parameters.dc, "V");
    case "currentSource": return formatValue(component.parameters.dc, "A");
    case "switch": return component.parameters.closed ? "closed" : "open";
    case "ground": return "";
  }
}

function symbol(component: Component, resolved: ResolvedCircuit, selected: boolean): SVGElement {
  const g = element("g", { transform: `translate(${component.position.x} ${component.position.y}) rotate(${component.rotation})`, "data-component": component.id, class: selected ? "symbol selected" : "symbol" });
  const body = element("g", { class: "symbol-body" });
  if (component.kind === "ground") {
    line(body, 0, 0, 0, 0.55);
    line(body, -0.85, 0.55, 0.85, 0.55);
    line(body, -0.56, 0.84, 0.56, 0.84);
    line(body, -0.25, 1.12, 0.25, 1.12);
  } else {
    line(body, -2, 0, -1.35, 0);
    line(body, 1.35, 0, 2, 0);
    if (component.kind === "resistor") body.append(element("polyline", { points: "-1.35,0 -1.08,-0.52 -0.65,0.52 -0.22,-0.52 0.22,0.52 0.65,-0.52 1.08,0.52 1.35,0" }));
    if (component.kind === "variableResistor") body.append(element("polyline", { points: "-1.35,0 -1.08,-0.52 -0.65,0.52 -0.22,-0.52 0.22,0.52 0.65,-0.52 1.08,0.52 1.35,0" }));
    if (component.kind === "lamp") { body.append(element("circle", { r: 1.2 })); line(body, -0.7, -0.7, 0.7, 0.7); line(body, -0.7, 0.7, 0.7, -0.7); }
    if (component.kind === "capacitor") {
      line(body, -1.35, 0, -0.26, 0); line(body, -0.26, -0.85, -0.26, 0.85);
      line(body, 0.26, -0.85, 0.26, 0.85); line(body, 0.26, 0, 1.35, 0);
    }
    if (component.kind === "inductor") body.append(element("path", { d: "M -1.35 0 Q -1.1 -1  -0.75 0 Q -0.4 -1 -0.05 0 Q 0.3 -1 0.65 0 Q 1 -1 1.35 0" }));
    if (component.kind === "voltageSource" || component.kind === "currentSource") {
      body.append(element("circle", { cx: 0, cy: 0, r: 1.35 }));
      if (component.kind === "voltageSource") {
        line(body, -0.82, -0.26, -0.42, -0.26); line(body, -0.62, -0.46, -0.62, -0.06);
        line(body, 0.42, 0.26, 0.82, 0.26);
      } else {
        line(body, -0.85, 0, 0.75, 0);
        body.append(element("polyline", { points: "0.35,-0.4 0.75,0 0.35,0.4" }));
      }
    }
    if (component.kind === "switch") {
      line(body, -1.35, 0, -0.85, 0);
      line(body, 0.85, 0, 1.35, 0);
      body.append(element("circle", { cx: -0.85, cy: 0, r: 0.13 }));
      body.append(element("circle", { cx: 0.85, cy: 0, r: 0.13 }));
      line(body, -0.85, 0, 0.8, component.parameters.closed ? 0 : -0.75);
    }
  }
  g.append(body);
  g.append(element("rect", { x: component.kind === "ground" ? -1 : -2.25, y: -1.45, width: component.kind === "ground" ? 2 : 4.5, height: 2.9, fill: "transparent", class: "hit-area" }));
  for (const pin of pins(component)) {
    const p = pinPosition(component, pin);
    const local = component.kind === "ground" ? { x: 0, y: 0 } : { x: pin === "a" ? -2 : 2, y: 0 };
    g.append(element("circle", { cx: local.x, cy: local.y, r: 0.36, class: "pin", fill: netColor(resolved.nodeByPin[`${component.id}:${pin}`]), "data-pin": pin, "data-component": component.id, "aria-label": `${component.ref} ${pin} at ${key(p)}` }));
  }
  return g;
}

export function drawSchematic(svg: SVGSVGElement, documentModel: CircuitDocument, resolved: ResolvedCircuit, view: View, selection: Selection, preview: Point[] = []): void {
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
  const defs = element("defs");
  const pattern = element("pattern", { id: "grid", width: 1, height: 1, patternUnits: "userSpaceOnUse" });
  pattern.append(element("circle", { cx: 0, cy: 0, r: 0.065, fill: "#38465c" }));
  defs.append(pattern);
  const bg = element("rect", { x: view.x, y: view.y, width: view.width, height: view.height, fill: "url(#grid)" });
  const layer = element("g");
  for (const wire of documentModel.wires) {
    const node = documentModel.components.flatMap((c) => pins(c).map((pin) => ({ p: pinPosition(c, pin), n: resolved.nodeByPin[`${c.id}:${pin}`] })))
      .find(({ p }) => wire.points.slice(1).some((end, index) => onSegment(p, wire.points[index]!, end)))?.n;
    const points = wire.points.map((p) => `${p.x},${p.y}`).join(" ");
    layer.append(element("polyline", { points, stroke: netColor(node), class: selection?.type === "wire" && selection.id === wire.id ? "wire selected" : "wire" }));
    layer.append(element("polyline", { points, class: "wire-hit", "data-wire": wire.id }));
  }
  for (const junction of documentModel.junctions) {
    layer.append(element("circle", { cx: junction.position.x, cy: junction.position.y, r: 0.25, class: selection?.type === "junction" && selection.id === junction.id ? "junction selected" : "junction", "data-junction": junction.id }));
  }
  for (const component of documentModel.components) {
    layer.append(symbol(component, resolved, selection?.type === "component" && selection.id === component.id));
    const label = element("text", { x: component.position.x + (component.rotation % 180 ? 1.3 : 0), y: component.position.y - (component.rotation % 180 ? 0.25 : 1.5), class: "component-label", "pointer-events": "none" }, `${component.ref}${value(component) ? ` · ${value(component)}` : ""}`);
    layer.append(label);
  }
  if (preview.length > 1) layer.append(element("polyline", { points: preview.map((p) => `${p.x},${p.y}`).join(" "), class: "wire preview" }));
  svg.replaceChildren(defs, bg, layer);
}

export function svgPoint(svg: SVGSVGElement, x: number, y: number): Point {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = new DOMPoint(x, y).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

export function fitView(documentModel: CircuitDocument, width: number, height: number): View {
  const points = [...documentModel.components.map((c) => c.position), ...documentModel.wires.flatMap((w) => w.points), ...documentModel.junctions.map((j) => j.position)];
  if (!points.length) return { x: -12, y: -9, width: 24, height: 18 };
  const minX = Math.min(...points.map((p) => p.x)) - 5, maxX = Math.max(...points.map((p) => p.x)) + 5;
  const minY = Math.min(...points.map((p) => p.y)) - 5, maxY = Math.max(...points.map((p) => p.y)) + 5;
  const ratio = Math.max(1, width) / Math.max(1, height);
  const w = Math.max(maxX - minX, (maxY - minY) * ratio);
  const h = w / ratio;
  return { x: (minX + maxX - w) / 2, y: (minY + maxY - h) / 2, width: w, height: h };
}
