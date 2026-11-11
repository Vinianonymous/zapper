import type { AnalysisKind, AnalysisResponse, CircuitDocument } from "../model/contracts";

export type AnalysisRunState =
  | { status: "idle" }
  | { status: "running"; requestId: string; revision: number }
  | { status: "stale" }
  | { status: "cancelled" }
  | { status: "complete"; response: Exclude<AnalysisResponse, { type: "progress" }> };

/** Backwards-compatible name from the Phase 2 DC-only client. */
export type DcRunState = AnalysisRunState;

export type WorkerFactory = () => Worker;

export class AnalysisClient {
  private worker?: Worker;
  private revision = 0;
  private active?: { requestId: string; revision: number };

  constructor(
    private readonly onState: (state: AnalysisRunState) => void,
    private readonly createWorker: WorkerFactory = () => new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" }),
  ) {}

  run(circuit: CircuitDocument, kind: AnalysisKind = "dc"): void {
    this.stop();
    const active = { requestId: crypto.randomUUID(), revision: this.revision };
    this.active = active;
    try {
      const worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
        const response = event.data;
        if (this.active !== active || response.requestId !== active.requestId || response.revision !== this.revision) return;
        if (response.type === "progress") return;
        this.stop();
        this.onState({ status: "complete", response });
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (this.active !== active) return;
        this.stop();
        this.onState({ status: "complete", response: { type: "failure", ...active, code: "internal-error", message: "The simulation worker failed. Try running again.", relatedIds: [] } });
      };
      this.onState({ status: "running", ...active });
      worker.postMessage({ type: "run", ...active, kind, circuit: structuredClone(circuit) });
    } catch {
      this.stop();
      this.onState({ status: "complete", response: { type: "failure", ...active, code: "internal-error", message: "Could not start the simulation worker.", relatedIds: [] } });
    }
  }

  /** Call on every schematic/property/settings edit, including undo, redo and replacement. */
  invalidate(): void {
    this.revision += 1;
    this.stop();
    this.onState({ status: "stale" });
  }

  cancel(): void {
    this.stop();
    this.onState({ status: "cancelled" });
  }

  dispose(): void { this.stop(); }

  private stop(): void {
    this.active = undefined;
    this.worker?.terminate();
    this.worker = undefined;
  }
}

/** Backwards-compatible alias from the Phase 2 DC-only client. */
export { AnalysisClient as DcAnalysisClient };
