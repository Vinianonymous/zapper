import type { Probe, ResolvedCircuit } from "../model/contracts";
import type { DcResult } from "../solver/dc";
import { pinKey } from "../topology/resolve";

export type DcReading = { probeId: string; value: number | null; unit: "V" | "A"; reference: string };

/** Missing/non-finite readings remain unavailable; never coerce them to zero. */
export function readDcProbe(probe: Probe, circuit: ResolvedCircuit, result: DcResult): DcReading {
  let value: number | undefined;
  if (probe.kind === "voltage") {
    const node = circuit.nodeByPin[pinKey(probe.at.componentId, probe.at.pin)];
    value = node === undefined ? undefined : result.nodeVolts[node];
  } else {
    value = result.branchAmps[probe.componentId];
  }
  return {
    probeId: probe.id,
    value: value !== undefined && Number.isFinite(value) ? value : null,
    unit: probe.kind === "voltage" ? "V" : "A",
    reference: probe.kind === "voltage" ? "Relative to ground (node 0)" : "Positive from pin a to pin b",
  };
}
