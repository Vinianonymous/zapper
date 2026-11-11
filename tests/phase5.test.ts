import { describe, expect, it } from "vitest";
import type { CircuitDocument } from "../src/model/contracts";
import { dividerExample, rcLowPassExample } from "../src/model/document";
import { importCircuit, MAX_FILE_BYTES, serializeCircuit, validateDocument } from "../src/persistence/json";
import { renderSchematic, schematicBounds } from "../src/rendering/schematic";
import { runAnalysis } from "../src/simulation/run";
import { resolveCircuit } from "../src/topology/resolve";
import { parseValue } from "../src/model/values";
import { readFileSync } from "node:fs";

describe("release regression fixtures", () => {
  it("keeps primary, muted, error and accent text above 4.5:1 on application surfaces", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const color = (token: string): string => {
      const value = new RegExp(`--${token}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1];
      if (!value) throw new Error(`Missing palette token ${token}`);
      return value;
    };
    const luminance = (hex: string): number => {
      const rgb = [1, 3, 5].map(offset => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      });
      return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
    };
    for (const foreground of ["text", "muted", "accent", "error", "warning"]) {
      for (const background of ["surface", "panel", "raised"]) {
        const a = luminance(color(foreground)), b = luminance(color(background));
        expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("accepts displayed time and frequency units in editors without confusing SI prefix case", () => {
    expect(parseValue("30 ms")).toBe(.03);
    expect(parseValue("10 µs")).toBeCloseTo(.00001);
    expect(parseValue("1 kHz")).toBe(1000);
    expect(parseValue("1 MΩ")).toBe(1e6);
    expect(parseValue("1 mΩ")).toBe(.001);
  });
  it.each([dividerExample(), dividerExample(true), rcLowPassExample()])("round-trips examples and all three analyses", (original) => {
    const source = original.components.find((c) => c.kind === "voltageSource")!;
    if (source.kind !== "voltageSource") throw new Error("Missing source");
    source.parameters.acMagnitude = 1;
    source.parameters.transient = { kind: "pulse", low: 0, high: 10, delay: .001, rise: .00001, fall: .00001, width: .002, period: .01 };
    const reopened = importCircuit(serializeCircuit(original));
    expect(reopened).toEqual(original);
    expect(resolveCircuit(reopened).nodeByPin).toEqual(resolveCircuit(original).nodeByPin);
    for (const kind of ["dc", "ac", "transient"] as const) {
      const request = { type: "run" as const, requestId: "release", revision: 7, kind };
      const before = runAnalysis({ ...request, circuit: original });
      expect(before.type).toBe("success");
      expect(runAnalysis({ ...request, circuit: reopened })).toEqual(before);
      expect(JSON.stringify(before)).not.toMatch(/NaN|Infinity|:null/);
    }
  });

  it("returns time-domain results rather than fake DC results for transient", () => {
    const response = runAnalysis({ type: "run", requestId: "transient", revision: 0, kind: "transient", circuit: dividerExample() });
    expect(response).toMatchObject({ type: "success", result: { kind: "transient" } });
  });

  it("escapes imported labels and reserves space for long full-width Unicode references", () => {
    const document = dividerExample();
    document.components[0]!.ref = '<script>alert("x")</script>&';
    const svg = renderSchematic(validateDocument(document)).svg;
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toMatch(/<script|onload=|<foreignObject|https?:\/\/(?!www.w3.org)/);
    document.components[0]!.ref = "電".repeat(40);
    const bounds = schematicBounds(document);
    expect(bounds.x).toBeLessThanOrEqual(-320);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(320);
  });
});

describe("untrusted file boundaries", () => {
  const invalid: [string, (doc: any) => void][] = [
    ["prototype keys", (d) => { d.components[0].parameters = JSON.parse('{"__proto__":{},"dc":10,"acMagnitude":0,"acPhaseDegrees":0,"transient":{"kind":"dc"}}'); }],
    ["unsupported component", (d) => { d.components[0].kind = "diode"; }],
    ["duplicate references", (d) => { d.components[1].ref = d.components[0].ref; }],
    ["cross-collection duplicate IDs", (d) => { d.probes[0].id = d.wires[0].id; }],
    ["missing pin", (d) => { d.probes[0].at.pin = "gnd"; }],
    ["nonfinite parameter", (d) => { d.components[0].parameters.dc = Infinity; }],
    ["oversized components", (d) => { d.components = Array(201).fill(d.components[0]); }],
    ["oversized wires", (d) => { d.wires = Array(501).fill(d.wires[0]); }],
    ["fractional coordinates", (d) => { d.components[0].position.x = .5; }],
    ["out of range coordinates", (d) => { d.components[0].position.x = 10001; }],
    ["zero length segment", (d) => { d.wires[0].points[1] = d.wires[0].points[0]; }],
    ["unbounded sweep", (d) => { d.settings.ac.points = 10001; }],
    ["unbounded time steps", (d) => { d.settings.transient = { durationSeconds: 1, stepSeconds: 1e-9 }; }],
    ["invalid pulse timing", (d) => { d.components[0].parameters.transient = { kind: "pulse", low: 0, high: 1, delay: 0, rise: 1, fall: 1, width: 1, period: 1 }; }],
  ];
  it.each(invalid)("rejects %s without mutating the caller", (_, mutate) => {
    const doc = dividerExample();
    mutate(doc);
    const before = structuredClone(doc);
    expect(() => validateDocument(doc)).toThrow();
    expect(doc).toEqual(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("bounds input bytes before JSON parsing and returns detached snapshots", () => {
    expect(() => importCircuit(" ".repeat(MAX_FILE_BYTES + 1))).toThrow(/1 MB/);
    expect(() => importCircuit("not json")).toThrow();
    const original: CircuitDocument = dividerExample();
    const copy = validateDocument(original);
    copy.components[0]!.ref = "Changed";
    expect(original.components[0]!.ref).toBe("V1");
  });
});
