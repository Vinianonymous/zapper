# Circuit Simulator — Product Requirements Document

**Status:** Phases 0–4 implemented; Phase 5 hardening implemented with release verification still open  
**Product:** A minimal, browser-based analog circuit simulator  
**Target release:** v1  
**Platform:** Modern desktop browsers; usable on tablets with a pointer or touch input  

## 1. Product summary

Build a fast, self-contained HTML application in which someone can draw a circuit, run a simulation, inspect electrical values, and export the schematic. The interface is **dark mode only**: there is no light-theme toggle or system-theme dependency. No account, backend, installation, or external simulation service is required.

“Minimal but full-fledged” means the complete workflow works for a deliberately limited set of **linear analog circuits**. It does not mean a SPICE-compatible component catalog. The first release includes DC operating point, AC frequency sweep, and transient simulation, along with clear diagnostics for unsupported or invalid circuits.

## 2. Users and goals

**Primary users:** students, educators, hobbyists, and engineers quickly checking small circuits.

**Jobs to be done:**

1. Sketch and modify a circuit without learning a netlist syntax.
2. See voltages and currents for a DC circuit.
3. Explore a filter’s frequency response and an RLC circuit’s time response.
4. Save an editable circuit and export a clean image for a report or presentation.

**Success criteria for v1:**

- A new user can build and simulate a voltage-divider example in under two minutes without instructions.
- Every supported example produces numerically correct results within the tolerances in §9.
- A saved circuit can be reopened without losing its topology, settings, or probe selections.
- An exported SVG/PNG is readable independently of the application.

## 3. Scope

### In scope for v1

| Area | Required behavior |
| --- | --- |
| Editor | Place, move, rotate, select, delete, and configure components; draw orthogonal wires; pan, zoom, fit-to-circuit; undo/redo. |
| Components | Resistor, capacitor, inductor, independent voltage source, independent current source, two-state switch, ground, and wire/junction. |
| Connectivity | Wires and component pins form electrical nets. A crossing is **not** connected unless a junction is explicitly present. A circuit needs a ground reference to simulate. |
| DC | Solve the operating point. Capacitors are open circuits; inductors are ideal shorts; switch state is fixed for the run. Show node voltages and supported branch currents. |
| AC | Sweep a user-defined frequency range using small-signal source magnitude/phase. Show probe magnitude and phase in Bode-style plots; use the current switch state throughout the sweep. |
| Transient | Simulate time-varying sources over a user-defined time span. Plot selected node voltages and branch currents. Support DC, sine, and pulse source waveforms. Use the DC operating point as the default initial condition. |
| Probes | Select a node voltage relative to ground or a component branch current; show numeric DC readings and plots for AC/transient. Provide a visible sign convention for currents. |
| Files | Export an editable, versioned circuit JSON file and re-import it. Export the schematic as standalone SVG or PNG. |
| Examples | Ship at least a voltage divider, RC filter, and RLC transient circuit that load directly in the app. |
| Appearance | One high-contrast dark palette across editor, controls, charts, and exported schematic. No theme selector. |

### Explicitly out of scope for v1

Transistors, diodes, op-amps, nonlinear devices, dependent sources, digital logic, PCB layout, SPICE/netlist compatibility, collaborative editing, cloud storage, accounts, mobile-phone editing, and user-authored component models. These can be considered after validating the core workflow; do not imply that imported unsupported parts can be simulated.

## 4. User experience

### Layout

- **Top bar:** app name, example picker, new, import, export, undo/redo, and run.
- **Left palette:** supported components and wire/junction tools.
- **Center:** zoomable SVG schematic on a subtle dark grid; component references and values remain legible at normal zoom.
- **Right inspector:** selected component properties, waveform/AC parameters, simulation settings, and validation messages.
- **Bottom panel:** DC measurements or AC/transient plots with probe picker and cursor readout. Resize or collapse the panel.

The editor is pointer-first, with keyboard access for common actions: Escape to cancel, Delete/Backspace to remove, Ctrl/Cmd+Z/Y for undo/redo, and a visible shortcut reference. Controls and dialogs must have labels and discernible focus states. Color must not be the only way to distinguish nets, traces, errors, or selected components.

### Core flows

1. **Create:** choose an example or start blank; drag/click to place parts; connect pins; edit values and source parameters in the inspector.
2. **Validate and run:** choose DC, AC, or transient; configure the sweep; run. Highlight a problematic element or net and explain how to fix it rather than showing a raw solver exception.
3. **Inspect:** click a node or component to add/remove a probe; view DC values or plotted traces; hover/click a chart for an exact reading.
4. **Export:** choose **Circuit JSON**, **SVG schematic**, or **PNG schematic** from one export menu; save with a sensible default filename. Import JSON from the top bar.

Changes to the circuit invalidate previous results until the next run; stale plots must be clearly marked or cleared. Undo/redo applies to schematic and property edits, not simulation playback or export actions. Warn before replacing a nonempty circuit with an imported file or example.

## 5. Functional requirements

### 5.1 Schematic and model

- Components have stable IDs, reference designators (for example, `R1`), typed parameters, position, rotation, and fixed electrical pins. Values accept common SI prefixes, such as `k`, `M`, `m`, `u`, `n`, and `p`, and display their physical units.
- A wire connects only where it terminates on a pin, wire endpoint/segment, or explicit junction. Merely drawing over a line without a junction does not silently merge nets. Visual junction dots identify actual connections.
- Moving a component must preserve attached wire connections or clearly detach them with immediate visual feedback; it must never silently change the simulated circuit.
- Source properties distinguish **DC value**, **AC magnitude/phase**, and **transient waveform**. A source without an AC magnitude contributes zero AC excitation. Sine and pulse waveforms have labeled parameters and validated time units.
- Switches have an open/closed property. Their state is constant within an individual simulation run; changing it requires a rerun. The closed/open approximation and its numerical limits must be documented in the UI.
- Component orientation determines the positive direction for voltage-source polarity and branch-current measurements; selecting a component shows the reference arrow.

### 5.2 Simulation

- Use modified nodal analysis (MNA) with a sparse or dense solver appropriate for the v1 circuit-size target. DC uses real-valued matrices; AC uses complex-valued matrices; transient uses a numerically stable implicit integration method (backward Euler is acceptable for v1).
- At DC, capacitors are open; inductors use a zero-volt branch constraint. At AC, use the usual frequency-dependent RLC relationships. At transient, use the element state carried between time steps; initialize from a valid DC operating point. If no valid initial condition exists, explain the failure instead of inventing one.
- Accept analysis settings: AC start/end frequency and point count (logarithmic sweep); transient duration and step size. Show units and validate positive values, ordered ranges, and resource caps before running.
- Errors must identify, where possible, a missing ground, floating net, unconnected pin, contradictory ideal sources, invalid value, or singular/ill-conditioned circuit. Do not show a successful result when the solver fails or returns non-finite values.
- Provide a cancel mechanism or keep the UI responsive during runs; perform computation in a Web Worker. The user can continue inspecting the schematic while analysis runs.
- Plots support at least two simultaneous probes, labeled axes/units, a legend, and a cursor readout. AC shows magnitude in dB for voltage/current relative to their respective base units and phase in degrees; DC shows values in V/A. Make the measurement reference explicit.

### 5.3 Import and export

- **Circuit JSON:** includes schema version, components and parameters, wires/junctions, probe selections, and simulation settings. Do not include solver internals or stale computed results. Import validates types, size limits, references, and supported schema version before replacing the current circuit. Invalid imports leave the current circuit untouched.
- **SVG schematic:** export a self-contained SVG with a viewBox tightly framing the circuit plus padding, explicit dark background, embedded styling, component labels/values, junctions, and no application chrome or remote assets. It must open in common browsers and vector editors.
- **PNG schematic:** render the same schematic and framing at a minimum of 2× display resolution, with readable labels and the dark background. Export must work even if no simulation has been run.
- If there is nothing to export, disable the relevant export action and explain why. Download filenames should be predictable, for example `circuit.svg`, `circuit.png`, and `circuit.json`.
- Exported diagrams contain the **schematic**, not simulation charts. Circuit JSON is the portable editable format; SVG/PNG are presentation formats.

## 6. Technology and architecture

**Recommended stack:** Vite + TypeScript, native HTML/CSS controls, SVG for editing/rendering/export, a dedicated Web Worker for the numerical solver, and a lightweight plotting implementation using SVG or Canvas. No framework or backend is required for v1; add a UI library only if real complexity justifies its bundle and maintenance cost.

Keep the electrical model, topology builder, numerical solver, editor interactions, and export serialization as separate modules. The simulation worker receives a validated circuit snapshot and returns typed results/errors. The app should be deployable as static files, with no runtime API or third-party CDN dependency. If a numerical or plotting library is adopted, pin it locally and keep the download size and browser performance budget in view.

Use a versioned JSON format from day one; define a migration path or a clear unsupported-version error for future revisions. Store the current workspace locally as a convenience, but keep explicit JSON export/import as the reliable backup and sharing path. Never upload circuit data.

## 7. Quality, safety, and accessibility

- **Performance target:** smooth pan/zoom/editing on a typical laptop for up to 200 components and 500 wires; complete a 200-component, 1,000-point AC sweep or 5,000-step transient analysis within 5 seconds on a reference mid-range laptop. Show progress or a busy state for longer runs. These are targets to benchmark, not guarantees on every device.
- **Numerical reliability:** define input bounds and solver tolerances; warn when approximations, coarse time steps, or ill-conditioned matrices may make a result inaccurate. Never return NaN/Infinity as a displayed measurement.
- **Accessibility:** semantic controls and dialogs, keyboard-accessible menus/inspector/export, visible focus, readable contrast, text alternatives for chart data (for example, a probe value table), and non-color error cues. SVG editing may remain pointer-first in v1; equivalent keyboard placement is not required.
- **Privacy/security:** no login, telemetry, or network calls at runtime. Treat imported files as untrusted data: validate JSON and render user-entered labels as text, never as HTML. Export SVG must not embed executable scripts or external resources.
- **Compatibility:** latest stable Chrome, Firefox, Safari, and Edge. Layout should remain usable at 1280×720; tablet is supported when space permits, but desktop is the primary target.

## 8. Development roadmap

Phases are sequential because each analysis builds on the same circuit model and solver. Estimates are **indicative for one developer**, not release commitments; complete the exit gate before starting work that depends on it. Add automated tests alongside each phase rather than postponing them to release.

### Phase 0 — Technical design and numerical prototype (3–5 days) — Complete

- Define the versioned circuit JSON shape, component pins, wire/junction rules, node numbering, units, probe references, and worker request/result contracts.
- Prototype MNA on a hard-coded voltage divider and an RC example; decide matrix-solver strategy and numeric tolerances before building the UI around it.
- Establish the Vite/TypeScript project, test runner, browser-test setup, and dark-only design tokens.
- **Exit gate:** documented data contracts and passing solver fixtures for simple DC circuits; no unresolved ambiguity about crossings, grounding, or current direction.

**Delivered:** [architecture and data contracts](docs/architecture.md), [typed circuit/worker interfaces](src/model/contracts.ts), [DC/AC MNA prototype](src/solver/prototype.ts), automated solver fixtures, and a Vite/TypeScript/Vitest/Playwright scaffold. The prototype takes pre-numbered nets; topology extraction, the editor, and production analysis remain in later phases.

### Phase 1 — Editable schematic and persistence (2–3 weeks) — Complete

- Build the dark application shell, SVG symbols/grid, selection, placement, rotation, property inspector, orthogonal wiring, explicit junctions, pan/zoom, and fit-to-circuit.
- Implement deterministic net extraction, stable IDs/references, value parsing, undo/redo, unsaved-work confirmation, and stale-result state.
- Add local workspace persistence, validated JSON import/export, and the voltage-divider starter schematic.
- Test topology edge cases (crossings, T-junctions, moved pins, disconnected nets) and JSON round trips.
- **Exit gate:** a user can draw and reopen a connected voltage divider; the visible connectivity matches the derived nets. Simulation is not presented as available until Phase 2.

**Delivered:** [architecture and data contracts](docs/architecture.md), [editor operations and wiring](src/editor/operations.ts), [undo/redo workspace](src/editor/workspace.ts), [deterministic topology extraction](src/topology/resolve.ts), [strict JSON validation and serialization](src/persistence/json.ts), [shared schematic renderer](src/rendering/schematic.ts), [dark editor UI](src/ui/app.ts), and [Phase 1 regression tests](tests/phase1.test.ts) plus the [editor browser flow](tests/e2e/phase1.spec.ts). The Phase 1 exit gate is verified: a voltage divider can be placed, wired, inspected, auto-saved, exported, and reopened with connectivity matching the derived nets.

### Phase 2 — Complete DC workflow and schematic export (2 weeks) — Complete

- Implement pre-run validation, a cancellable Web Worker, real-valued MNA, DC models for all v1 components, and actionable errors for groundless/floating/contradictory circuits.
- Add node-voltage and branch-current probes, DC readings, current-direction indicators, and open/closed switch behavior.
- Export the current schematic as self-contained dark SVG and high-resolution PNG from one shared rendering path; keep JSON as the editable format.
- Test the voltage-divider numerical fixture, switch cases, invalid circuits, and SVG/PNG output outside the app.
- **Exit gate:** the complete draw → simulate → inspect → export flow works for DC circuits; acceptance criteria **1, 4, 5 (DC), and 7** pass.

### Phase 3 — AC frequency analysis (1–2 weeks) — Complete

- Add AC source amplitude/phase, complex MNA for RLC components, and validated logarithmic sweep settings.
- Build magnitude/phase plots with at least two probes, units, legend, cursor readout, and a text-accessible value view.
- Add the RC low-pass example; test cutoff response, phase/sign conventions, missing AC excitation, and invalid frequency ranges.
- **Exit gate:** the filter can be drawn or loaded, swept, inspected, and exported; acceptance criterion **2** passes.

### Phase 4 — Transient analysis (2 weeks) — Complete

- Add DC, sine, and pulse waveform editors; DC operating-point initialization; implicit time stepping for RLC elements; and validated duration/step controls.
- Add time-series probe plots, simulation busy/cancel states, and useful diagnostics when initialization or integration fails.
- Add the RLC transient example; test RC step response, source timing, energy-storage behavior, switch-state consistency, and cancellation.
- **Exit gate:** transient examples produce stable, inspectable traces; acceptance criterion **3** passes, and edits invalidate previous traces.

**Delivered:** [backward-Euler transient solver](src/solver/transient.ts), [time-domain plots](src/ui/transient-chart.ts), waveform and duration/step controls, RLC pulse example, cancellation/staleness guards, and [numerical regression fixtures](tests/phase4.test.ts). See [Phase 4 documentation](docs/phase-4.md) for initialization, waveform semantics and numerical limits.

### Phase 5 — Release hardening (1–2 weeks) — Implemented; verification open

- Verify all three modes together against numerical fixtures, import/export round trips, and end-to-end editor workflows; fix regressions rather than expanding component scope.
- Audit keyboard/focus behavior, labels, contrast, chart alternatives, untrusted JSON/SVG safety, and no-network operation.
- Benchmark the §7 size/performance targets; test latest Chrome, Firefox, Safari, and Edge at the stated viewport; polish onboarding and error copy.
- Package as static files and publish documentation covering supported components, source parameters, switch approximation, numerical limits, and file formats.
- **Release gate:** every criterion in §9 passes; no known issue can silently change connectivity, corrupt an imported circuit, or display a failed solve as valid output.

**Delivered:** [release hardening report and remaining checks](docs/phase-5.md), [user/deployment documentation](README.md), [cross-mode and untrusted-input regressions](tests/phase5.test.ts), [production-browser hardening workflows](tests/e2e/phase5.spec.ts), and [reproducible size-target benchmarks](benchmarks/release.bench.ts). Keyboard focus, cancelled-drag connectivity, stale preview results, Unicode export bounds, and pan/zoom redraws are hardened. The release gate is **not yet signed off**: Firefox/WebKit/Edge and manual Safari/accessibility checks remain unverified here, and large-matrix sweeps exceed the existing work cap despite meeting the component-count limit.

**Milestone order:** editable circuit → useful DC simulator with image export → AC sweeps → transient plots → verified v1 release. Defer out-of-scope features from §3 and §10 until these gates are met.

## 9. Acceptance criteria

Release is complete when all of the following pass:

1. A user can create `10 V → 1 kΩ → node → 1 kΩ → ground`, run DC, and read approximately **5 V** at the midpoint and **5 mA** through each resistor (relative error ≤ 0.1%).
2. An RC low-pass example with `R = 1 kΩ` and `C = 1 µF` has a −3 dB frequency near **159 Hz** (within 2% when evaluated at that frequency); an AC sweep shows magnitude and phase with correct units.
3. An RC transient example driven by a pulse source that steps from 0 V to 10 V after the start of the run approaches its final voltage monotonically; one time constant after the step, the capacitor voltage is within 2% of **63.2%** of its final value when the configured time step is at most one-hundredth of that constant.
4. Opening a switch breaks its path, closing it restores the path, and changing the switch state marks prior results stale.
5. Groundless, floating, and contradictory-source examples fail with actionable messages; no incorrect success state or non-finite chart values appear.
6. A circuit survives JSON export/import with identical connectivity, component parameters, probe selections, and analysis settings. Invalid or unsupported JSON does not modify the open circuit.
7. SVG and PNG exports include the complete schematic (no clipped labels), retain the dark styling, and open outside the app. Their images omit toolbar, inspector, and plots.
8. The examples run out of the box. Editing, simulation, and export work without an account, server API, or theme setting.
9. Automated unit tests cover topology, DC/AC/transient solver fixtures, import validation, and serialization; browser tests cover drawing, running, importing, and exporting.

## 10. Open product decisions

The following are intentionally deferred, not silent v1 promises: nonlinear semiconductor support, time-controlled switch events, explicit user-defined initial conditions, CSV export of plots, and SPICE import/export. Prioritize them using feedback after the linear-circuit workflow is reliable.
