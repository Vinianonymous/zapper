# Phase 2 — DC analysis and schematic export

Phase 2 is implemented. The application supports the complete DC workflow:
draw or import a circuit, run a cancellable solve in a Web Worker, inspect
voltage/current probes, diagnose invalid circuits, and export the schematic.
AC analysis ships in [Phase 3](phase-3.md); transient analysis ships in
[Phase 4](phase-4.md).

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/simulation/validation.ts` | Preflight: empty circuit, missing ground, value bounds and AC sweep range |
| `src/topology/resolve.ts` | Deterministic nets from component pins, wires, junctions and ground; crossing rules |
| `src/solver/dc.ts` | Dense real MNA, row equilibration, partial pivoting, DC models, numerical diagnostics |
| `src/simulation/run.ts` | Tagged pipeline from document snapshot to result or `AnalysisFailure` |
| `src/simulation/analysis.worker.ts` | Worker entry point for DC and AC solves |
| `src/simulation/client.ts` | Request/revision guards, cancellation, stale invalidation, worker disposal |
| `src/probes/dc.ts` | Ground-referenced voltage readings and signed `a → b` current readings |
| `src/rendering/schematic.ts` | Shared dark SVG renderer used by the editor and export |
| `src/export/schematic.ts` | Self-contained SVG and 2× PNG export from the shared renderer |
| `src/persistence/json.ts` | Strict untrusted JSON validation and serialization |
| `src/ui/app.ts` | Editor controls, Run/Cancel, results table, diagnostics and export UI |

## DC model semantics

- Resistors use `1/R` conductance. Capacitors are exact opens.
- Inductors and closed switches are ideal zero-volt branches; open switches are
  exact opens.
- Independent voltage sources add an ideal branch and appear in the results with
  their signed current. Independent current sources inject `dc` from pin `a` to
  pin `b`.
- Node 0 is ground. Every ground symbol merges into node 0.
- Unconnected pins, floating islands, contradictory ideal constraints, singular
  systems, ill-conditioned systems and non-finite values fail with an actionable
  code, message and related component IDs. A failed or stale solve never fills
  probe readings with fake zeros.

## Cancellation and staleness

The main thread sends an immutable document snapshot with a request ID and
monotonic revision. Cancel terminates the active worker, because a DC solve is
synchronous and cannot handle a queued message mid-solve. Every edit, undo,
redo, switch change, import or example load invalidates a completed result and
clears readings; late worker responses are ignored.

## Export

JSON is the editable format. SVG is a standalone dark document with escaped
labels, no scripts, no external references and label-aware bounds. PNG renders
the same SVG at 2× through a canvas, with size guards to avoid unsafe allocations.

## Verification

- `npm run typecheck`
- `npm test` — topology, solver, probes, persistence, rendering and worker client
- `npm run build`
- `npm run test:e2e` — editor persistence, DC solver, probe readings, staleness,
  invalid imports, missing-ground diagnostics, and JSON/SVG/PNG downloads

The numerical fixture `10 V → 1 kΩ → midpoint → 1 kΩ → ground` yields 5 V and
5 mA within the required tolerance.
