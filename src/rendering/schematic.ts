import type { CircuitDocument } from "../model/contracts";
import type { Component, Point, SourceParameters } from "../model/contracts";
import { GRID, onSegment, pins, pointKey, samePoint, segments } from "../model/geometry";
import { formatValue } from "../model/values";

export type RenderedSchematic = { svg: string; width: number; height: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type RenderOptions = { selectedId?: string; relatedIds?: string[]; interactive?: boolean };
export const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

function sourceValue(parameters: SourceParameters, unit: string): string {
  if (parameters.acMagnitude === 0) return formatValue(parameters.dc, unit);
  const phase = parameters.acPhaseDegrees === 0 ? "" : ` ∠${Number(parameters.acPhaseDegrees.toPrecision(4))}°`;
  return `${formatValue(parameters.acMagnitude, unit)} AC${phase}`;
}

export function componentValue(c: Component): string {
  switch (c.kind) {
    case "resistor":
    case "variableResistor":
    case "lamp": return formatValue(c.parameters.ohms, "Ω");
    case "capacitor": return formatValue(c.parameters.farads, "F");
    case "inductor": return formatValue(c.parameters.henrys, "H");
    case "voltageSource": return sourceValue(c.parameters, "V");
    case "currentSource": return sourceValue(c.parameters, "A");
    case "switch": return c.parameters.closed ? "Closed" : "Open";
    case "ground": return "Ground";
  }
}

export function schematicBounds(document: CircuitDocument): Bounds {
  const points: Point[] = document.wires.flatMap((w) => w.points.map((p) => ({ x: p.x * GRID, y: p.y * GRID })));
  points.push(...document.junctions.map((j) => ({ x: j.position.x * GRID, y: j.position.y * GRID })));
  for (const c of document.components) {
    // Allow full-width Unicode glyphs as well as ASCII in imported references.
    const halfWidth = Math.max(55, Math.max(c.ref.length, componentValue(c).length) * 8);
    points.push({ x: c.position.x * GRID - halfWidth, y: c.position.y * GRID - 50 }, { x: c.position.x * GRID + halfWidth, y: c.position.y * GRID + 80 });
  }
  if (!points.length) return { x: -200, y: -150, width: 800, height: 500 };
  const minX = Math.min(...points.map((p) => p.x)) - 30, minY = Math.min(...points.map((p) => p.y)) - 30;
  return { x: minX, y: minY, width: Math.max(...points.map((p) => p.x)) + 30 - minX, height: Math.max(...points.map((p) => p.y)) + 30 - minY };
}

/** Actual connection dots, never dots on a bare interior/interior crossing. */
export function connectionDots(document: CircuitDocument): Point[] {
  const candidates = [...document.wires.flatMap((w) => w.points), ...document.components.flatMap((c) => pins(c).map((p) => p.position)), ...document.junctions.map((j) => j.position)];
  const dots = new Map(document.junctions.map((j) => [pointKey(j.position), j.position]));
  const allSegments = document.wires.flatMap(segments);
  const allPins = document.components.flatMap(pins);
  for (const p of candidates) {
    const directions = new Set<string>();
    for (const [a, b] of allSegments) if (onSegment(p, a, b)) {
      for (const end of [a, b]) if (!samePoint(end, p)) directions.add(`${Math.sign(end.x - p.x)},${Math.sign(end.y - p.y)}`);
    }
    const pinCount = allPins.filter((pin) => samePoint(pin.position, p)).length;
    if (directions.size + pinCount >= 3) dots.set(pointKey(p), p);
  }
  return [...dots.values()];
}

function symbol(c: Component): string {
  const lead = '<path d="M-40 0H-23 M23 0H40"/>';
  switch (c.kind) {
    case "resistor": return lead + '<path d="M-23 0L-18 -10 -10 10 -2 -10 6 10 14 -10 22 0"/>';
    case "variableResistor": return lead + '<path d="M-23 0L-18 -10 -10 10 -2 -10 6 10 14 -10 22 0 M-6 -21L9 17 M3 13L9 17 10 10"/>';
    case "lamp": return lead + '<circle r="22"/><path d="M-15 -15L15 15 M15 -15L-15 15"/>';
    case "capacitor": return '<path d="M-40 0H-6 M6 0H40 M-6 -19V19 M6 -19V19"/>';
    case "inductor": return lead + '<path d="M-23 0C-23 -22 -11 -22 -11 0C-11 -22 1 -22 1 0C1 -22 13 -22 13 0C13 -22 23 -22 23 0"/>';
    case "voltageSource": return lead + '<circle r="23"/><path d="M-16 0H-6 M-11 -5V5 M7 0H17"/>';
    case "currentSource": return lead + '<circle r="23"/><path d="M-13 0H13 M6 -6L13 0 6 6"/>';
    case "switch": return '<path d="M-40 0H-20 M20 0H40"/><circle cx="-20" r="3"/><circle cx="20" r="3"/>' + (c.parameters.closed ? '<path d="M-18 0H18"/>' : '<path d="M-18 0L16 -20"/>');
    case "ground": return '<path d="M0 0V18 M-18 18H18 M-12 25H12 M-5 32H5"/>';
  }
}

export function schematicContent(document: CircuitDocument, options: RenderOptions = {}): string {
  const error = new Set(options.relatedIds ?? []);
  const wireContent = document.wires.map((w) => `<polyline${options.interactive ? ` data-wire="${escapeXml(w.id)}"` : ""} points="${w.points.map((p) => `${p.x * GRID},${p.y * GRID}`).join(" ")}" fill="none" stroke="${error.has(w.id) ? "#ff8793" : options.selectedId === w.id ? "#ffd580" : "#80c9ff"}" stroke-width="3" ${options.selectedId === w.id ? 'stroke-dasharray="7 3"' : ""}/>`).join("");
  const componentContent = document.components.map((c) => {
    const selected = options.selectedId === c.id;
    const color = error.has(c.id) ? "#ff8793" : selected ? "#ffd580" : "#eef2f9";
    const x = c.position.x * GRID, y = c.position.y * GRID;
    const arrow = selected && c.kind !== "ground" ? '<path d="M-30 -32H30 M22 -38L30 -32 22 -26" stroke="#ffd580"/><text x="0" y="-43" text-anchor="middle" fill="#ffd580" stroke="none" font-size="11">a → b</text>' : "";
    const body = `<g${options.interactive ? ` data-component="${escapeXml(c.id)}"` : ""}><g transform="translate(${x} ${y}) rotate(${c.rotation})" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${options.interactive ? '<rect x="-45" y="-25" width="90" height="50" fill="transparent" stroke="none"/>' : ""}${selected ? '<rect x="-46" y="-27" width="92" height="54" rx="5" stroke-dasharray="4 4"/>' : ""}${symbol(c)}${arrow}</g><text x="${x}" y="${y + 59}" fill="${color}" text-anchor="middle">${escapeXml(c.ref)}</text><text x="${x}" y="${y + 77}" fill="#aebbd0" text-anchor="middle">${escapeXml(componentValue(c))}</text></g>`;
    const pinContent = pins(c).map((pin) => {
      const probed = document.probes.some((p) => p.kind === "voltage" && p.at.componentId === c.id && p.at.pin === pin.name);
      return `<circle ${options.interactive ? `data-pin="${pin.name}" data-owner="${escapeXml(c.id)}"` : ""} cx="${pin.position.x * GRID}" cy="${pin.position.y * GRID}" r="${probed ? 6 : 4}" fill="#10141c" stroke="${probed ? "#c9a7ff" : color}" stroke-width="2"/>`;
    }).join("");
    return body + pinContent;
  }).join("");
  const dots = connectionDots(document).map((p) => `<circle cx="${p.x * GRID}" cy="${p.y * GRID}" r="4" fill="#80c9ff"/>`).join("");
  // Explicit dots are separately selectable; inferred dots are informational only.
  const junctionHits = options.interactive ? document.junctions.map((j) => `<circle data-junction="${escapeXml(j.id)}" cx="${j.position.x * GRID}" cy="${j.position.y * GRID}" r="8" fill="transparent" stroke="${options.selectedId === j.id ? "#ffd580" : "none"}"/>`).join("") : "";
  return `<g font-family="monospace" font-size="13">${wireContent}${dots}${componentContent}${junctionHits}</g>`;
}

/** Shared pure rendering boundary for editor symbols and both image export formats. */
export function renderSchematic(document: CircuitDocument): RenderedSchematic {
  const bounds = schematicBounds(document);
  return { width: bounds.width, height: bounds.height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img" aria-label="Circuit schematic"><title>Circuit schematic</title><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#10141c"/>${schematicContent(document)}</svg>` };
}
