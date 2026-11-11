import type { AnalysisRequest, AnalysisResponse } from "../model/contracts";
import { runAnalysis } from "./run";

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  // The client terminates the worker for cancellation: synchronous DC and AC
  // work cannot process a queued cancel message until the run has finished.
  if (event.data.type !== "run") return;
  const response: AnalysisResponse = runAnalysis(event.data);
  scope.postMessage(response);
};
