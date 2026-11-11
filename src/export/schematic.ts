import type { CircuitDocument } from "../model/contracts";
import { renderSchematic } from "../rendering/schematic";

export type ImageFormat = "svg" | "png";

export function canExportSchematic(document: CircuitDocument): boolean {
  return document.components.length > 0 || document.wires.length > 0 || document.junctions.length > 0;
}

/** Both formats consume exactly the same standalone SVG; PNG is rendered at 2x. */
export async function exportSchematic(document: CircuitDocument, format: ImageFormat): Promise<Blob> {
  if (!canExportSchematic(document)) throw new Error("There is no schematic to export.");
  const rendered = renderSchematic(document);
  const svg = new Blob([rendered.svg], { type: "image/svg+xml;charset=utf-8" });
  if (format === "svg") return svg;
  if (rendered.width * 2 > 16384 || rendered.height * 2 > 16384 || rendered.width * rendered.height * 4 > 32_000_000) {
    throw new Error("Schematic is too large for safe PNG export. Move parts closer together or export SVG instead.");
  }
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = documentCanvas(rendered.width * 2, rendered.height * 2);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export requires a Canvas 2D context.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png",
    ));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function documentCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  return canvas;
}
