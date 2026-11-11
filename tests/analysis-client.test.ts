import { expect, it, vi } from "vitest";
import type { AnalysisResponse, CircuitDocument } from "../src/model/contracts";
import { DcAnalysisClient, type DcRunState } from "../src/simulation/client";

class FakeWorker {
  onmessage: ((event: MessageEvent<AnalysisResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

const document: CircuitDocument = {
  schemaVersion: 1, components: [], wires: [], junctions: [], probes: [],
  settings: { ac: { startHz: 1, stopHz: 10, points: 10 }, transient: { durationSeconds: 1, stepSeconds: .01 } },
};

function setup() {
  const workers: FakeWorker[] = [];
  const states: DcRunState[] = [];
  const client = new DcAnalysisClient((state) => states.push(state), () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { client, workers, states };
}

it("snapshots input and ignores responses after an edit", () => {
  const { client, workers, states } = setup();
  client.run(document);
  const worker = workers[0]!;
  const request = worker.postMessage.mock.calls[0]![0];
  expect(request.circuit).toEqual(document);
  expect(request.circuit).not.toBe(document);
  expect(request.kind).toBe("dc");
  client.invalidate();
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.onmessage?.({ data: { type: "success", requestId: request.requestId, revision: request.revision, result: { kind: "dc", nodeVolts: [0], branchAmps: {} } } } as MessageEvent<AnalysisResponse>);
  expect(states.at(-1)).toEqual({ status: "stale" });
});

it("forwards the requested AC analysis kind to the worker", () => {
  const { client, workers } = setup();
  client.run(document, "ac");
  expect(workers[0]!.postMessage.mock.calls[0]![0].kind).toBe("ac");
});

it("cancels transient work and ignores its late result", () => {
  const { client, workers, states } = setup();
  client.run(document, "transient");
  const worker = workers[0]!;
  const request = worker.postMessage.mock.calls[0]![0];
  expect(request.kind).toBe("transient");
  client.cancel();
  worker.onmessage?.({ data: { type: "success", requestId: request.requestId, revision: request.revision, result: { kind: "transient", timesSeconds: [0], probes: {} } } } as MessageEvent<AnalysisResponse>);
  expect(states.at(-1)).toEqual({ status: "cancelled" });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("terminates synchronous work on cancel and creates a new worker for the next run", () => {
  const { client, workers, states } = setup();
  client.run(document);
  client.cancel();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  expect(states.at(-1)).toEqual({ status: "cancelled" });
  client.run(document);
  expect(workers).toHaveLength(2);
  client.dispose();
  expect(workers[1]!.terminate).toHaveBeenCalledOnce();
});

it("accepts only matching requests and releases workers on completion", () => {
  const { client, workers, states } = setup();
  client.run(document);
  const worker = workers[0]!;
  const request = worker.postMessage.mock.calls[0]![0];
  const response: AnalysisResponse = { type: "failure", requestId: request.requestId, revision: request.revision, code: "not-implemented", message: "Pending", relatedIds: [] };
  worker.onmessage?.({ data: { ...response, requestId: "other" } } as MessageEvent<AnalysisResponse>);
  expect(states.at(-1)?.status).toBe("running");
  worker.onmessage?.({ data: response } as MessageEvent<AnalysisResponse>);
  expect(states.at(-1)).toEqual({ status: "complete", response });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
