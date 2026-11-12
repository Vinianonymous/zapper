# Circuit Simulator

A dark-only, local browser schematic editor with DC, AC and transient analysis.
Circuit data stays on your device; no accounts, telemetry, runtime APIs or CDN
assets are used. Desktop is the primary target (1280×720 or larger).

## Run and deploy

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm start
```

For deployment, run `npm run build` and publish **all of `dist/`** to any static
HTTP(S) host. Relative asset URLs support hosting under a subdirectory. The host
must serve JavaScript modules and the worker with correct MIME types. There is
no application server. `npm run preview` serves the built files locally;
opening `index.html` over `file://` is not supported. Network access is needed
to initially load the static files; an offline-installable PWA is not provided.

## First circuit

1. The starter voltage divider is already wired and has two probes. Click
   **Run DC**: the midpoint reads **5 V**, and R1 reads **5 mA**.
2. Select a component to edit its reference, value, position or source parameters.
   Values accept SI prefixes: `1k`, `1 kΩ`, `1 µF`, `10 ms`, `1 kHz`.
   Prefix case matters: `m` is milli, `M` is mega.
3. Use **Wire** to click a start and an end. Hold Shift for a vertical-first
   elbow. A bare wire crossing is not connected; place a **Junction** to join it.
   Wire endpoints, component pins and overlapping collinear wires do connect.
4. Start a wire at a pin or existing wire. Moving/rotating a part moves its
   attached wire endpoints; deleting it removes wires touching its pins.
   Edits, undo and redo clear valid readings until rerun.
5. Load **RC low-pass** for magnitude/phase plots or **RLC pulse response** for
   time-domain plots. Loading/importing warns before replacing a nonempty circuit.

Select a voltage probe by clicking a pin with the V tool, or a current probe by
clicking a two-terminal part with the A tool. Voltage is relative to ground;
positive current flows **a → b**. Source pin a is positive relative to b. Selecting
a part shows its direction arrow. Charts have named traces and dash patterns,
keyboard-operable sample sliders and expandable sampled-value tables.

`Ctrl/Cmd+Enter` runs the selected analysis. Short local tones play when you
place/delete parts or wires and when a run starts/finishes (browser audio support
required). `Escape` cancels a tool/gesture, `Delete`/`Backspace` deletes selection, `R`
rotates, `Ctrl/Cmd+Z` undoes, and `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z` redoes.
Scroll to zoom; middle-drag or the Pan tool pans. The editor is pointer-first;
controls, properties and results are keyboard accessible.

## Electrical models and source parameters

| Part | DC | AC | Transient |
| --- | --- | --- | --- |
| Resistor | Ohm's law | Same | Same |
| Variable resistor | Adjustable fixed resistance (two terminals) | Same | Same |
| Lamp | Fixed resistance approximation (no brightness/thermal model) | Same | Same |
| Capacitor | Open | `jωC` admittance | Backward Euler history of voltage |
| Inductor | Ideal zero-volt branch | `1/(jωL)` admittance | Backward Euler history of current |
| Voltage/current source | DC value | Independent magnitude and phase | DC, sine or pulse waveform |
| Switch | Exact short when closed, exact open otherwise | Same | Same; fixed state per run |
| Ground | Shared zero-voltage reference | Same | Same |

Switches have **no artificial leakage or on-resistance**. Ideal short/source
loops can be singular, even if their constraints agree. Add realistic series
resistance to remove redundancy. Every circuit needs a connected ground and a
valid path for its selected analysis. Diodes, transistors, dependent sources,
SPICE netlists and nonlinear models are unsupported.

- DC and AC source parameters are separate. Zero AC magnitude means no AC
  excitation. AC uses `Re{V exp(jωt)}`; magnitude is amplitude, phase is degrees.
  Plots show dB relative to 1 V or 1 A; zero magnitude is drawn at −200 dB.
- Transient starts from the **DC operating point at t=0**, not an invented
  all-zero state. If initialization fails, the run fails. After t=0 the selected
  waveform applies; a discontinuity between DC and waveform is intentional.
- DC waveform uses the source DC value. Sine uses offset, nonnegative amplitude,
  frequency in Hz and phase in degrees (`sin(2πft + phase)`).
- Pulse uses low/high values, delay, rise, fall, high-plateau width and period,
  all times in seconds. Rise + width + fall must fit the period; zero rise/fall
  is allowed. Pulses repeat after the delay. Features shorter than the time step
  may be missed: the solver does not automatically refine steps at edges.
- Backward Euler is stable but damps oscillations. Use step ≤ RC/100 for an RC
  step and at least 100 steps per waveform period; refine further for short
  edges or RLC resonance. Compare a smaller step to check convergence.

Runs execute in a Web Worker. **Cancel** terminates it; inspecting, panning and
zooming remain available. Failures never count as valid results. Diagnostics
identify missing ground, floating/unconnected pins, contradictory ideal sources
and singular/ill-conditioned matrices where possible.

## Numerical and resource limits

- 200 components, 500 wires, 500 junctions, 1,000 probes; 2,000 total wire points.
- Integer grid coordinates from −10,000 to 10,000; rotations 0/90/180/270°.
- Resistance: `1e-6–1e12 Ω`; capacitance: `1e-15–1e3 F`;
  inductance: `1e-15–1e6 H`. Source values and AC magnitude are bounded at `1e9`
  in base units (AC magnitude nonnegative). All values must be finite.
- AC: `1e-9–1e12 Hz`, start < stop, 2–10,000 logarithmically spaced points.
- Transient: duration/step `1e-12–1e6 s`, step ≤ duration, at most 100,000 steps;
  the final step is shortened to end at the requested duration.
- Dense MNA: DC ≤800 unknowns; AC/transient ≤600 unknowns and estimated work
  `unknowns³ × points/steps ≤250,000,000`. Transient also caps stored probe
  samples at 2,000,000. A circuit within the drawing limits can still exceed
  analysis limits: reduce points/steps or circuit complexity.
- Row-equilibrated, pivoted solves reject pivots below `1e-15` (singular) or
  `1e-12` (ill-conditioned). Solutions require a residual within `1e-9` of the
  equation scale (floor `1e-12`). Accepted value ranges do not guarantee a
  well-conditioned circuit; extreme value ratios may still be rejected.

## Files and privacy

**Circuit JSON** is the editable backup/share format: strict schema version 1,
components, wires, junctions, probes and both analysis settings. Units are SI
numbers. It excludes results, viewport and undo history. Imports are limited to
1 MB, reject unsupported versions/fields/parts and invalid references, and leave
the open circuit untouched on failure. See [contracts](src/model/contracts.ts).

**SVG** and **PNG** export only the schematic, tightly framed with dark background,
labels and junctions, without charts or application chrome. SVG is standalone;
labels are XML-escaped and cannot inject scripts. PNG uses the same rendering
at 2× resolution. PNG dimensions are limited to 16,384 pixels per axis and
32 million pixels; move distant parts closer or export SVG when over the cap.
Exports do not require a successful simulation. Empty schematics cannot export.
Default names are `circuit.json`, `circuit.svg` and `circuit.png`.

The current workspace auto-saves to browser local storage. Storage may be blocked,
cleared or unavailable; **export JSON for reliable backup**. There is no cloud
recovery. Serve locally for operation without Internet access.

## Verification

```sh
npm test                    # topology, serialization, safety and solver fixtures
npm run build               # typecheck plus static production package
npm run test:e2e            # Chromium, built app, 1280×720
npm run test:e2e:all        # Chromium, Firefox, WebKit and installed Edge
npm run benchmark          # reproducible size/work-limit benchmark
```

Browser tests require installed Playwright browsers (`npx playwright install
chromium firefox webkit`) and, for the Edge project, a local Edge installation.
WebKit is an engine-level proxy; manually test current Safari on macOS and
current Chrome/Firefox/Edge before declaring release compatibility.

See [release hardening and remaining verification](docs/phase-5.md).
