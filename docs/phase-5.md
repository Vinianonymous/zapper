# Phase 5 — Release hardening

Status: implemented regression coverage and hardening; **release verification
remains open**, not a claim that every browser/performance target passes.

## Delivered

- Cross-mode JSON round trips compare topology, parameters, probes, settings and
  complete DC/AC/transient responses. Existing numerical fixtures cover divider,
  RC cutoff, delayed RC step, RLC state, switches and actionable solver failures.
- Adversarial import fixtures cover unsupported parts/fields, prototype keys,
  duplicate IDs/references, dangling probes, non-finite parameters, resource caps,
  coordinates, wire geometry and waveform timing. Validation does not mutate input.
- Cancelled drag previews now restore the original document rather than leaving
  unsaved, un-undoable connectivity changes. Moving previews immediately invalidate
  old/in-flight results. Returning to the original drag location works. Replacing
  a document clears unfinished wire gestures.
- Palette selection has `aria-pressed`. Property edits and asynchronous renders
  preserve focus; native Tab movement completes before rebuilding fields. Active
  property drafts survive repainting. Units accepted by fields include s and Hz.
  Core text/muted/accent/error/warning palette tokens are regression-tested at
  ≥4.5:1 contrast against the three main surfaces.
- Pan/zoom update the SVG viewBox without rebuilding symbols, topology, controls
  and charts. Junction rendering reuses extracted pins instead of extracting them
  once per candidate dot.
- Conservative Unicode-label bounds prevent clipping full-width references.
  Browser fixtures open exported SVG without application CSS and check actual
  text bounding boxes; script-like imported references remain plain text.
- Browser regression covers keyboard edits, cancelled drags, stale readings,
  AC text alternatives, import/export, work cancellation on a 200-part/500-wire
  circuit and a static-only request boundary (no external requests or runtime APIs).
- Production build has relative asset paths for static subdirectory deployment.
  Playwright serves the production package at 1280×720 and defines Chromium,
  Firefox, WebKit and actual Edge projects. Default local testing uses Chromium;
  `npm run test:e2e:all` requests the entire matrix without silently skipping it.
- [README](../README.md) documents onboarding, components, source parameters,
  switch idealization, numerical/resource limits, formats, privacy and deployment.

## Reproducible performance evidence

Run `npm run benchmark`. Fixture generation is in
[`benchmarks/fixtures.ts`](../benchmarks/fixtures.ts). Both fixtures contain exactly
200 components and 500 wires. Timings include normal validation and topology in
analysis calls. Tests assert success/rejection semantics, not hardware-dependent
timing thresholds.

Observed on Linux x64, Intel Core Ultra 7 155U, Node v26.10.0 (2026-11-01):

| Fixture | Topology ×10 | Standalone SVG ×10 | DC | AC 1,000 points | Transient 5,000 steps |
| --- | ---: | ---: | ---: | ---: | ---: |
| 198 parallel resistors + source/ground | 404 ms | 604 ms | 39 ms | 783 ms | 900 ms |
| 198 series resistors + source/ground | 370 ms | 371 ms | 47 ms | Rejected by work cap | Rejected by work cap |

These are single observations, not guarantees or browser frame-rate measurements.
Decorative disconnected wires fill the editor wire target without adding matrix
unknowns. The second topology has 199 unknowns and deliberately exposes the dense
solver's work cap. **The general 200-component AC/transient performance target is
not met for all topologies.** Do not raise the cap without measuring actual cost.
Pan/zoom avoids document regeneration, but full edit/render frame rates still need
interactive profiling on the reference laptop. A sparse/factorization optimization
is follow-up work, not a scope expansion of electrical components.

## Compatibility and remaining release checks

- Local validation: `npm run build` passes; `npm test` passes 78 tests;
  `npm run test:e2e` passes 17 Chromium workflows against the production package;
  `npm run benchmark` passes its success/resource-rejection assertions.
- Chromium production-build workflows are exercised locally. Firefox, WebKit and
  Edge launch checks were attempted but their binaries are absent in this image.
  Install them and run `npm run test:e2e:all`; manually exercise current Safari on
  macOS (WebKit automation alone does not establish Safari compatibility).
- The suite tests semantic labels, focus order, keyboard sliders, non-color trace
  patterns and text alternatives. A full screen-reader/manual contrast audit and
  tablet input check remain release tasks; do not equate these regressions with
  an independent accessibility certification.
- The app needs only static HTTP files, including the worker, not Internet/API
  connectivity. The no-network regression forbids outside origins and fetch/XHR
  while allowing same-origin asset loads. It does not promise offline first-load
  or offline reload caching.
- SVG/PNG presentation is shared and PNG encoding/dark framing are browser-tested.
  Confirm presentation in the supported vector editors and Safari as part of
  the remaining manual compatibility pass.

PRD §9 numerical/persistence/workflow acceptance has automated coverage. Final
release sign-off remains pending the cross-browser/manual checks above; §7's
general large-matrix performance goal is a documented limitation.
