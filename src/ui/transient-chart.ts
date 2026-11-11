import type { CircuitDocument } from "../model/contracts";
import type { TransientResult } from "../solver/transient";
import { formatValue } from "../model/values";
import { AC_COLORS, AC_DASHES } from "./ac-chart";

const escape = (text: string): string => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

export function transientView(document: CircuitDocument, result: TransientResult | undefined, cursor: number): string {
  if (!result) return '<p class="muted">Run transient analysis to plot voltage and current over time.</p>';
  const times = result.timesSeconds;
  cursor = Math.max(0, Math.min(cursor, times.length - 1));
  const series = document.probes.map((probe, index) => {
    const id = probe.kind === "voltage" ? probe.at.componentId : probe.componentId;
    const ref = document.components.find(c => c.id === id)?.ref ?? "missing";
    return { label: probe.kind === "voltage" ? `${ref}.${probe.at.pin} to ground` : `${ref} current (a → b)`, unit: probe.kind === "voltage" ? "V" : "A", values: result.probes[probe.id]!, color: AC_COLORS[index % AC_COLORS.length]!, dash: AC_DASHES[index % AC_DASHES.length]! };
  });
  if (!series.length) return '<p class="muted">No probes selected. Add voltage or current probes and rerun.</p>';
  const legend = series.map(s => `<span class="ac-legend-item"><svg class="ac-swatch" viewBox="0 0 32 12" aria-hidden="true"><line x1="0" x2="32" y1="6" y2="6" stroke="${s.color}" stroke-width="2" stroke-dasharray="${s.dash}"/></svg>${escape(s.label)} (${s.unit})</span>`).join("");
  const charts = ["V", "A"].map(unit => {
    const entries = series.filter(s => s.unit === unit);
    if (!entries.length) return "";
    let low = 0, high = 0;
    for (const s of entries) for (const value of s.values) { low = Math.min(low, value); high = Math.max(high, value); }
    const padding = (high - low || 1) * .08;
    low -= padding; high += padding;
    const x = (t: number): number => 68 + t / times.at(-1)! * 816;
    const y = (v: number): number => 28 + (high - v) / (high - low) * 162;
    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const t = times.at(-1)! * i / 4, v = low + (high - low) * i / 4;
      grid += `<line x1="${x(t)}" x2="${x(t)}" y1="28" y2="190" stroke="#303d4f"/><text x="${x(t)}" y="208" text-anchor="middle" fill="#aebbd0" font-size="11">${escape(formatValue(t, "s"))}</text>`;
      grid += `<line x1="68" x2="884" y1="${y(v)}" y2="${y(v)}" stroke="#303d4f"/><text x="58" y="${y(v) + 4}" text-anchor="end" fill="#aebbd0" font-size="11">${escape(formatValue(v, unit))}</text>`;
    }
    const paths = entries.map(s => {
      const points: string[] = [];
      const count = Math.min(1000, times.length);
      for (let i = 0; i < count; i++) {
        const index = Math.round(i * (times.length - 1) / (count - 1));
        points.push(`${x(times[index]!).toFixed(2)},${y(s.values[index]!).toFixed(2)}`);
      }
      return `<polyline points="${points.join(" ")}" stroke="${s.color}" stroke-dasharray="${s.dash}" stroke-width="2" fill="none"><title>${escape(s.label)}</title></polyline>`;
    }).join("");
    return `<div class="ac-chart transient-chart"><svg viewBox="0 0 900 230" role="img" aria-label="Transient ${unit === "V" ? "voltage" : "current"} response"><text x="68" y="17" fill="#eef2f9" font-size="12">${unit === "V" ? "Voltage (V)" : "Current (A)"}</text>${grid}${paths}<line x1="${x(times[cursor]!)}" x2="${x(times[cursor]!)}" y1="28" y2="190" stroke="#f9c974" stroke-dasharray="4 4"/><text x="476" y="226" text-anchor="middle" fill="#aebbd0" font-size="11">Time (s)</text></svg></div>`;
  }).join("");
  const readout = `${formatValue(times[cursor]!, "s")} · ` + series.map(s => `${s.label}: ${formatValue(s.values[cursor]!, s.unit)}`).join(" · ");
  const rows = Array.from({ length: Math.min(21, times.length) }, (_, i) => {
    const index = Math.round(i * (times.length - 1) / (Math.min(21, times.length) - 1));
    return `<tr><td>${escape(formatValue(times[index]!, "s"))}</td>${series.map(s => `<td>${escape(formatValue(s.values[index]!, s.unit))}</td>`).join("")}</tr>`;
  }).join("");
  return `<p class="muted">Backward Euler, initialized from the DC operating point at t = 0. Switch state is fixed. Smaller time steps improve accuracy; coarse steps may miss pulses or damp oscillations.</p><div class="ac-legend">${legend}</div>${charts}<label class="ac-cursor-control">Time sample <input id="transient-cursor" type="range" min="0" max="${times.length - 1}" value="${cursor}" aria-describedby="transient-readout"/></label><p id="transient-readout" class="ac-readout" role="status">${escape(readout)}</p><details class="ac-table"><summary>Text-accessible sampled time values</summary><div class="ac-table-scroll"><table><caption>Transient probe values</caption><thead><tr><th>Time</th>${series.map(s => `<th>${escape(s.label)} (${s.unit})</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
