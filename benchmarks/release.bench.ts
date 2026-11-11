import { expect, it } from "vitest";
import { cpus } from "node:os";
import { validateDocument } from "../src/persistence/json";
import { renderSchematic } from "../src/rendering/schematic";
import { resolveCircuit } from "../src/topology/resolve";
import { runAnalysis } from "../src/simulation/run";
import { releaseFixture } from "./fixtures";

it("reports size-target timings and rejected work without claiming unsupported targets pass", () => {
  console.info(`Reference: ${cpus()[0]?.model}; Node ${process.version}; ${process.platform}/${process.arch}`);
  for (const series of [false, true]) {
    const circuit = validateDocument(releaseFixture(series));
    expect(circuit.components).toHaveLength(200);
    expect(circuit.wires).toHaveLength(500);
    const measure = <T>(label: string, run: () => T): T => {
      const start = performance.now();
      const result = run();
      console.info(`${series ? "series" : "parallel"} ${label}: ${(performance.now() - start).toFixed(1)} ms`);
      return result;
    };
    measure("topology (10 iterations)", () => { for (let i = 0; i < 10; i++) resolveCircuit(circuit); });
    measure("SVG rendering (10 iterations)", () => { for (let i = 0; i < 10; i++) renderSchematic(circuit); });
    for (const kind of ["dc", "ac", "transient"] as const) {
      const response = measure(kind, () => runAnalysis({ type: "run", requestId: "benchmark", revision: 0, circuit, kind }));
      if (series && kind !== "dc") {
        expect(response.type).toBe("failure");
      } else expect(response.type).toBe("success");
      console.info(`${kind}: ${response.type === "failure" ? `${response.code}: ${response.message}` : "success"}`);
    }
  }
});
