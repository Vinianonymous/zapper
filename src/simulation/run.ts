import type { AnalysisRequest, AnalysisResponse } from "../model/contracts";
import { resolveCircuit } from "../topology/resolve";
import { solveDc } from "../solver/dc";
import { sweepAc } from "../solver/ac";
import { AnalysisFailure } from "./diagnostics";
import { validateAnalysisInput } from "./validation";
import { simulateTransient } from "../solver/transient";

export function runAnalysis(request: Extract<AnalysisRequest, { type: "run" }>): AnalysisResponse {
  const tags = { requestId: request.requestId, revision: request.revision };
  try {
    const diagnostic = validateAnalysisInput(request.circuit, request.kind)[0];
    if (diagnostic) throw new AnalysisFailure(diagnostic);
    const resolved = resolveCircuit(request.circuit);
    const result = request.kind === "ac"
      ? sweepAc(resolved, request.circuit.settings.ac)
      : request.kind === "transient" ? simulateTransient(resolved) : solveDc(resolved);
    return { type: "success", ...tags, result };
  } catch (error) {
    const diagnostic = error instanceof AnalysisFailure ? error.diagnostic : {
      code: "internal-error" as const,
      message: "Analysis could not complete. Review the circuit and try again.",
      relatedIds: [],
    };
    return { type: "failure", ...tags, ...diagnostic };
  }
}
