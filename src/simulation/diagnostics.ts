import type { AnalysisErrorCode } from "../model/contracts";

export type Diagnostic = {
  code: AnalysisErrorCode;
  message: string;
  relatedIds: string[];
};

export class AnalysisFailure extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = "AnalysisFailure";
  }
}

export function notImplemented(message: string): never {
  throw new AnalysisFailure({ code: "not-implemented", message, relatedIds: [] });
}
