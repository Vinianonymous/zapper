# Phase 3 — AC frequency analysis

Phase 3 is implemented. The application now runs logarithmic AC sweeps in the
same cancellable Web Worker pipeline as DC analysis and plots probe magnitude
and phase over frequency.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/solver/ac.ts` | Dense complex MNA, AC connectivity, phasor sources, sweep limits, probe phasors |
| `src/simulation/validation.ts` | Shared DC/AC preflight plus AC source and sweep-range checks |
| `src/simulation/run.ts` | Dispatches DC, AC and (since Phase 4) transient analysis |
| `src/simulation/client.ts` | Analysis-kind-aware worker client with revision guards and cancellation |
| `src/simulation/analysis.worker.ts` | Worker entry point for DC and AC runs |
| `src/ui/ac-chart.ts` | Shared magnitude/phase SVG charts and logarithmic cursor geometry |
| `src/model/document.ts` | `rcLowPassExample()` and named starter circuits |
| `src/ui/app.ts` | Analysis-kind selector, AC settings, legend, charts, cursor, sampled table |
| `src/styles.css` | Dark AC chart, legend, readout and table presentation |

## AC model semantics

- Sources use the phasor `acMagnitude ∠ acPhaseDegrees` in polar form. The
  `dc` value is ignored during an AC sweep, so a source with
  `acMagnitude: 0` produces a valid all-zero response instead of borrowing its
  DC value.
- Resistors use `1/R`. Capacitors use `jωC`. Inductors use `1/(jωL)`.
- Independent voltage sources and closed switches are ideal zero-volt branches
  with a branch current unknown; open switches are exact opens. Current sources
  inject their AC phasor from pin `a` to pin `b`.
- Ground is node 0. Every ground symbol merges into node 0.
- The phase convention is `V(t) = Re{V e^{jωt}}`. A first-order RC low-pass
  therefore has its output at `−45°` at the corner frequency; the current
  through the series resistor leads by `+45°`.
- Capacitors and inductors count as an AC signal path even though they do not
  provide a DC path. Contradictory ideal constraints, floating nets, missing
  probes and non-finite values fail with actionable diagnostics.

## Sweep and charts

- Settings are a positive start frequency, a greater stop frequency, and an
  integer point count from 2 to 10000. Frequencies are inclusive and evenly
  spaced in `log10(f)`.
- Work limits reject sweeps above 600 unknowns or `unknowns³ × points > 250,000,000`
  before solving, keeping one synchronous worker run bounded.
- The UI shows the probe legend, magnitude in dB, phase in degrees, a shared
  cursor readout with magnitude/phase/dB values, and a sampled text table.
- Traces and legend swatches use matching dash patterns as well as color.
  A keyboard-accessible sample slider inspects every sweep point, including
  points omitted from the sampled table. Magnitude dB is relative to 1 V or 1 A;
  zero magnitude uses a finite −200 dB display floor.
- The RC low-pass example loads a 1 V / 0° source, 1 kΩ, 1 µF, ground, and three
  probes, then selects AC automatically. At
  `1/(2πRC) ≈ 159.154943 Hz` the output is `0.70710678 V` at `−45°`.

## Cancellation, staleness and export

The client carries the analysis kind with an immutable snapshot, request ID and
monotonic revision. Switching DC/AC, editing a component, changing AC settings,
undo/redo, import or example load marks previous results stale and clears the
plots. Cancel terminates the active worker because DC and AC solves are
synchronous. Schematic JSON/SVG/PNG export is independent of the last analysis.

## Transient analysis

Transient analysis is now implemented in [Phase 4](phase-4.md), using separate
waveform parameters and backward Euler with DC initialization. The UI offers
DC, AC and transient analysis through the same worker pipeline.

## Verification

- `npm run typecheck`
- `npm test` — cutoff magnitude/phase, phase/sign conventions, logarithmic
  spacing, missing excitation, invalid ranges, contradictory AC sources,
  probe phasors and analysis-kind forwarding
- `npm run build`
- `npm run test:e2e` — RC example run, legend and both charts, shared cursor
  readout, sampled accessible table, settings validation, plus the Phase 1/2
  editor, DC, staleness, diagnostics and export flows
