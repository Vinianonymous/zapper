# Phase 4 — Transient analysis

Transient analysis is implemented alongside DC and AC in the cancellable worker.
Select **RLC pulse response**, load it, and choose **Run Transient** to inspect
the voltage and current traces. All analysis modes use the same circuit format.

## Numerical model

- `src/solver/transient.ts` uses real modified nodal analysis and backward Euler.
  Capacitors use a `C/Δt` conductance with voltage history. Inductors use a branch
  equation with `L/Δt` and current history. Resistors, independent voltage/current
  sources and fixed-state ideal switches retain their existing conventions.
- A valid DC operating point supplies the initial capacitor voltages and inductor
  currents. The t = 0 sample is this operating point, using each source's **DC
  value**, independently of its waveform. Initialization failure is reported,
  never replaced with fabricated zero states.
- Each subsequent time point evaluates the source waveform at the step endpoint.
  The final step is shortened to end at the requested duration exactly.
- DC waveforms use the source's DC value. Sine is
  `offset + amplitude × sin(2πft + phase)`. Pulse begins at `low`, waits for
  `delay`, rises, holds `high` for `width`, falls, and repeats with `period`.
  Width excludes rise/fall; zero edge durations are allowed. Pulses are sampled
  on the time grid, not adaptively event-aligned.
- Current is positive from pin a to b; voltage probes are relative to ground.
  Every solve checks pivots, finite values and the original-equation residual.

## Settings and limits

Duration and step accept seconds with SI prefixes, such as `20 ms` and `10 us`.
Both must be positive, step must not exceed duration, and no more than 100000
steps are allowed. Runs also reject over 600 unknowns, estimated
`unknowns³ × steps > 250000000`, or more than 2000000 stored probe samples.
These dense-solver resource guards are not a performance guarantee.

Backward Euler is stable but introduces numerical damping. Use step ≤ RC/100
for accurate RC steps, at least 100 samples per sine period, and small steps
relative to pulse plateaus/edges and RLC oscillation periods. The inspector
warns when source timing is under-resolved. Narrow pulses can be missed entirely
on a coarse grid. Reduce the step and compare runs when accuracy matters.

## Interaction

`src/ui/transient-chart.ts` provides separate voltage/current axes, a labeled
legend with color and dash patterns, a shared hover cursor, a keyboard-accessible
time-sample slider and a text-accessible sampled table. The slider exposes every
computed sample, including those omitted from the table and reduced plot paths.

Run/Cancel, revision guards and stale-result invalidation use the shared worker
client. Cancel terminates synchronous worker computation immediately; late
responses cannot revive cancelled or stale results. Editing sources, switch
state, settings, topology or probes invalidates the plots. Schematic JSON/SVG/PNG
export remains independent of simulation and never includes computed traces.

## Verification

`tests/phase4.test.ts` covers RC step accuracy and monotonicity, capacitor/current
consistency, DC initialization, damped RLC ringing and energy dissipation,
current-source sine polarity, pulse timing, fixed switch states, partial final
steps, invalid initialization, resource caps and safe chart labels.
`tests/analysis-client.test.ts` covers transient cancellation and late responses.
`tests/e2e/phase4.spec.ts` covers the RLC example, plots, cursor, accessible table,
waveform editing, SI time settings, staleness, invalid settings and JSON export.
