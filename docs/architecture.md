# Architecture and data contracts

This documents decisions for the linear analog v1 in [PRD.md](../PRD.md). Phase 0 defined the contracts and a pre-numbered-net solver prototype. Phase 1 added the dark SVG editor, deterministic topology extraction, and validated persistence; Phase 2 added the production DC worker and schematic export; Phase 3 added complex AC sweep analysis and plots (see [`docs/phase-3.md`](phase-3.md)); Phase 4 added backward-Euler transient analysis with DC initialization and time-domain plots (see [`docs/phase-4.md`](phase-4.md)). The TypeScript declarations live in [`src/model/contracts.ts`](../src/model/contracts.ts).

## Persistence and coordinate rules

- `CircuitDocument.schemaVersion` is exactly `1`. Serialized JSON contains `components`, `wires`, `junctions`, `probes`, and `settings`; no computed nodes/results or UI cache. Unknown versions are rejected, not silently loaded. IDs and references are unique strings; IDs remain stable on edits.
- Positions and wire points are integer editor grid coordinates, not CSS pixels. Wires are orthogonal polylines with two or more points and no zero-length segments. Rotation is one of 0, 90, 180, 270 degrees. The importer will check types, uniqueness, size bounds, valid pin references, finite numbers, and waveforms before replacing a document.
- Components use fixed **local** pin offsets in grid units: every two-pin component has `a=(-2,0)` and `b=(2,0)`; ground has `gnd=(0,0)`. Apply clockwise screen rotation, then translate to `position`. Voltage-source `a` is positive and `b` negative; current-source arrow and measured branch current are positive from `a` to `b`. Other branch currents are also positive from `a` to `b`. A ground pin maps to node 0.
- Resistor `ohms`, capacitor `farads`, and inductor `henrys` must be strictly positive. Source `dc`, `acMagnitude` (nonnegative), and `acPhaseDegrees` are SI-valued numbers (volts or amps as appropriate). Sine uses offset/amplitude in V or A, frequency in Hz, phase in degrees; pulse levels in V or A and times in seconds. Switch state is Boolean. User-facing SI text is parsed at the UI boundary; JSON stores numbers only.
- `transient: {kind:"dc"}` means a constant waveform at the source's `dc` value; sine/pulse override that value during transient analysis. `dc` is independently used for the initial DC operating point. A missing AC excitation is represented by `acMagnitude: 0` (not the DC value).

## Topology and probes

- Ground is node **0**; other nets get deterministic positive integer IDs from the lexicographically smallest component pin key (`componentId:pin`) in the connected group. A net containing only unused wires does not get a simulation node. IDs are regenerated on edits and never serialized.
- A pin touching a wire endpoint or a wire segment is a connection. A wire endpoint terminating on another segment creates a T-junction. Two segment interiors crossing without an explicit junction do **not** connect; an explicit junction at their crossing connects them. Collinear overlap is one electrical wire. A visual dot appears for actual branch connections. Phase 1 must test each case before deriving node IDs.
- Voltage probes anchor to a stable `componentId` and pin, not to a derived node number; their reference is always ground. Current probes anchor to a component ID and use its `a → b` reference direction. Deleting an anchor requires removing or explicitly invalidating the probe. Render source polarity and current direction when inspecting.
- One electrically connected ground reference is required for each simulated network. Disconnected ungrounded islands and unsupported ideal-source constraints fail validation. Component IDs/coordinates can help locate failures; a matrix error alone is not sufficient UX.

## Worker boundary

- The main thread validates a document and sends a `run` message with `requestId`, monotonically increasing `revision`, analysis kind, and an immutable document snapshot. The worker resolves topology and solves, returning tagged `progress`, `success`, or `failure` messages. The UI ignores responses whose request/revision is not current.
- Cancellation terminates the active worker for DC, AC and transient runs, so synchronous numerical work stops immediately. After a circuit edit, old results are marked stale, even if an earlier worker message arrives later. A failure carries a human-readable message, error code, and related component/wire IDs when available.
- DC results use node 0 = 0 V, node-indexed volts, and component-ID-indexed signed amps; AC results contain frequency points and probe magnitude/phase; transient results contain time points and probe values in SI units. Neither charts nor exported circuit JSON should store solver internals.

## Solver prototype and numerical policy

- `src/solver/prototype.ts` is a **hard-coded-net numerical spike**, not a production circuit parser. It stamps resistors, capacitors, and independent voltage sources into MNA. DC uses a real-valued system; the capacitor is open. AC uses complex R/C admittances via an equivalent doubled real system (`[Re -Im; Im Re]`). The voltage-source branch variable is signed current leaving its positive (`a`) pin. The production path is `src/solver/dc.ts` and `src/solver/ac.ts`, which add inductors, current sources, switches, shared diagnostics and worker integration.
- Use dense Gaussian elimination with partial pivoting. Reject non-finite inputs/outputs and pivots smaller than `max(1e-14, 1e-12 × row scale)`; this is a provisional guard, **not** a proof of accurate conditioning. This 200-component product target needs benchmarking and likely a better scaled/sparse method before release. Numerical accuracy targets are in PRD §9; the production solvers add explicit input bounds, complex row equilibration and classified solver errors for the UI.
- DC fixtures: 10 V and two 1 kΩ resistors yield 5 V and 5 mA; a source–resistor–capacitor chain yields 10 V at the capacitor and 0 A at steady state. AC fixture: the 1 kΩ / 1 µF low-pass is −3.0103 dB and −45° at `1/(2πRC)` Hz, matching the Phase 3 verification.

## Phase 1 implementation

- **Editor shell:** `index.html` and `src/ui/app.ts` provide the dark-only workbench: component palette, SVG canvas, property inspector, probe list, connectivity summary, keyboard shortcuts, and local auto-save.
- **Editing model:** `src/editor/operations.ts` handles insertion, deterministic references, orthogonal wire routing, explicit junctions, rotation, movement, probes, and deletion. `src/editor/workspace.ts` owns document snapshots, undo/redo, and validation on replacement.
- **Topology:** `src/topology/resolve.ts` unions pins, wire endpoints, T-junctions, collinear overlaps, and explicit `junctions`. Two crossing wire interiors stay electrically separate unless a junction dot is present. Every ground pin maps to node 0.
- **Persistence:** `src/persistence/json.ts` validates schema version, exact fields, unique IDs/references, orthogonal wires, finite bounded numbers, pin-referenced probes, and size limits before import. Unknown versions and unknown fields are rejected. `serializeCircuit` is the canonical export path.
- **Rendering:** `src/rendering/schematic.ts` is the single SVG renderer used by the interactive editor and by JSON/SVG/PNG export, so exported diagrams match the canvas.
- **Starter and recovery:** the app loads a connected voltage divider, restores a valid saved document when available, and falls back to the starter circuit if stored data is invalid.

## Phase 1 verification

- `tests/phase1.test.ts` covers non-connecting crossings, explicit junction connections, T-junctions, collinear overlap, ground mapping, JSON round trips, unsupported/duplicate/invalid documents, wire routing, reference allocation, probe cleanup, and SI value parsing.
- `tests/e2e/phase1.spec.ts` places a part, draws a wire, checks local persistence, exports JSON, reloads, and confirms the restored schematic.
- `tests/e2e/scaffold.spec.ts` and `tests/e2e/smoke.spec.ts` cover the shell, the dark-only presentation, and the starter DC flow.

## Workflow

`npm install`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` are available. For browser tests install the test browser first with `npx playwright install chromium`. Browser tests cover the editor flow, DC and AC analysis, plots and cursor readout, diagnostics, staleness, and JSON/SVG/PNG export.
