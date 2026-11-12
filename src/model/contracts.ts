/** v1 persisted format. Every numerical field uses SI base units, never formatted strings. */
export type Point = { x: number; y: number };
export type Rotation = 0 | 90 | 180 | 270;
export type ComponentKind = "resistor" | "variableResistor" | "lamp" | "capacitor" | "inductor" | "voltageSource" | "currentSource" | "switch" | "ground";
export type TwoPinKind = Exclude<ComponentKind, "ground">;
export type PinName = "a" | "b" | "gnd";
export type PinRef = { componentId: string; pin: PinName };

type BaseComponent<K extends ComponentKind, P> = {
  id: string;
  kind: K;
  ref: string;
  position: Point;
  rotation: Rotation;
  parameters: P;
};

export type Waveform =
  | { kind: "dc" }
  | { kind: "sine"; offset: number; amplitude: number; frequency: number; phaseDegrees: number }
  | { kind: "pulse"; low: number; high: number; delay: number; rise: number; fall: number; width: number; period: number };

export type SourceParameters = {
  dc: number;
  acMagnitude: number;
  acPhaseDegrees: number;
  transient: Waveform;
};

export type Component =
  | BaseComponent<"resistor", { ohms: number }>
  | BaseComponent<"variableResistor", { ohms: number }>
  | BaseComponent<"lamp", { ohms: number }>
  | BaseComponent<"capacitor", { farads: number }>
  | BaseComponent<"inductor", { henrys: number }>
  | BaseComponent<"voltageSource", SourceParameters>
  | BaseComponent<"currentSource", SourceParameters>
  | BaseComponent<"switch", { closed: boolean }>
  | BaseComponent<"ground", Record<string, never>>;

export type Wire = { id: string; points: Point[] };
export type Junction = { id: string; position: Point };
export type Probe =
  | { id: string; kind: "voltage"; at: PinRef }
  | { id: string; kind: "current"; componentId: string };

export type AnalysisSettings = {
  ac: { startHz: number; stopHz: number; points: number };
  transient: { durationSeconds: number; stepSeconds: number };
};

export type CircuitDocument = {
  schemaVersion: 1;
  components: Component[];
  wires: Wire[];
  junctions: Junction[];
  probes: Probe[];
  settings: AnalysisSettings;
};

/** Resolved node IDs are assigned by topology extraction, never persisted or used as probe anchors. */
export type ResolvedCircuit = {
  document: CircuitDocument;
  nodeByPin: Record<string, number>;
  nodeCount: number;
};

export type AnalysisKind = "dc" | "ac" | "transient";
export type AnalysisRequest =
  | { type: "run"; requestId: string; revision: number; kind: AnalysisKind; circuit: CircuitDocument }
  | { type: "cancel"; requestId: string };

export type AnalysisResult =
  | { kind: "dc"; nodeVolts: number[]; branchAmps: Record<string, number> }
  | { kind: "ac"; frequenciesHz: number[]; probes: Record<string, { magnitude: number[]; phaseDegrees: number[] }> }
  | { kind: "transient"; timesSeconds: number[]; probes: Record<string, number[]> };

export type AnalysisErrorCode =
  | "invalid-input" | "missing-ground" | "floating-net" | "unconnected-pin" | "contradictory-sources"
  | "singular-matrix" | "ill-conditioned" | "cancelled" | "internal-error" | "not-implemented";

export type AnalysisResponse =
  | { type: "progress"; requestId: string; revision: number; completed: number; total: number }
  | { type: "success"; requestId: string; revision: number; result: AnalysisResult }
  | { type: "failure"; requestId: string; revision: number; code: AnalysisErrorCode; message: string; relatedIds: string[] };
