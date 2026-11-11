import { formatValue } from "../model/values";

export type AcSeries = {
  probeId: string;
  label: string;
  unit: "V" | "A";
  color: string;
  magnitude: number[];
  phaseDegrees: number[];
};

export type PlotMetric = "magnitude" | "phase";

export type AcPlotGeometry = {
  width: number;
  height: number;
  left: number;
  top: number;
  plotWidth: number;
  plotHeight: number;
  minLog: number;
  maxLog: number;
  frequencyCount: number;
};

export type AcPlot = { svg: string; geometry: AcPlotGeometry };

export const AC_COLORS = ["#80c9ff", "#6ee7b7", "#f9c974", "#d7b2ff", "#ff9faf", "#7dd3fc", "#b9d779", "#f4a3c0"];
export const AC_DASHES = ["", "8 4", "2 4", "10 3 2 3", "6 3", "2 2", "12 4", "8 3 2 3 2 3"];

const WIDTH = 900;
const HEIGHT = 230;
const LEFT = 68;
const RIGHT = 16;
const TOP = 28;
const BOTTOM = 40;
const MAX_PATH_POINTS = 800;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const magnitudeDb = (value: number): number => value > 0 && Number.isFinite(value) ? 20 * Math.log10(value) : -200;

export function formatPhase(degrees: number): string {
  if (!Number.isFinite(degrees)) return "Unavailable";
  const rounded = Number(degrees.toFixed(1));
  return `${Object.is(rounded, -0) ? 0 : rounded}°`;
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]!));
}

function niceDbStep(span: number): number {
  if (span <= 40) return 10;
  if (span <= 100) return 20;
  if (span <= 250) return 50;
  return 100;
}

function sampledIndices(length: number): number[] {
  if (length <= MAX_PATH_POINTS) return Array.from({ length }, (_, index) => index);
  const indices = new Set<number>();
  for (let i = 0; i < MAX_PATH_POINTS; i++) {
    indices.add(Math.round(i * (length - 1) / (MAX_PATH_POINTS - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

function xTickValues(frequenciesHz: number[]): number[] {
  const first = frequenciesHz[0]!;
  const last = frequenciesHz[frequenciesHz.length - 1]!;
  const minLog = Math.log10(first);
  const maxLog = Math.log10(last);
  const decades: number[] = [];
  for (let exponent = Math.ceil(minLog); exponent <= Math.floor(maxLog); exponent++) {
    decades.push(10 ** exponent);
  }
  if (decades.length >= 2) return decades;
  const middle = frequenciesHz[Math.floor((frequenciesHz.length - 1) / 2)]!;
  return [...new Set([first, middle, last])];
}

/** Shared scale/cursor map for the magnitude and phase charts. */
export function acPlotGeometry(frequenciesHz: number[]): AcPlotGeometry {
  const minLog = Math.log10(frequenciesHz[0] ?? 1);
  const maxLog = Math.log10(frequenciesHz[frequenciesHz.length - 1] ?? 10);
  return {
    width: WIDTH, height: HEIGHT, left: LEFT, top: TOP,
    plotWidth: WIDTH - LEFT - RIGHT, plotHeight: HEIGHT - TOP - BOTTOM,
    minLog, maxLog, frequencyCount: frequenciesHz.length,
  };
}

export function acCursorX(geometry: AcPlotGeometry, index: number): number {
  const span = geometry.maxLog - geometry.minLog;
  const ratio = span > 0 && geometry.frequencyCount > 1 ? index / (geometry.frequencyCount - 1) : 0;
  return geometry.left + clamp(ratio, 0, 1) * geometry.plotWidth;
}

/** Nearest sweep index for a pointer position in viewBox units. */
export function acIndexAtX(geometry: AcPlotGeometry, frequenciesHz: number[], x: number): number {
  if (!frequenciesHz.length) return 0;
  const clamped = clamp((x - geometry.left) / geometry.plotWidth, 0, 1);
  const targetLog = geometry.minLog + clamped * (geometry.maxLog - geometry.minLog);
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < frequenciesHz.length; index++) {
    const distance = Math.abs(Math.log10(frequenciesHz[index]!) - targetLog);
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  }
  return best;
}

export function acPlot(
  frequenciesHz: number[],
  series: AcSeries[],
  metric: PlotMetric,
  cursorIndex: number,
): AcPlot {
  const geometry = acPlotGeometry(frequenciesHz);
  const { left, top, plotWidth, plotHeight, minLog, maxLog } = geometry;
  const x = (frequency: number): number =>
    left + (maxLog === minLog ? 0 : (Math.log10(frequency) - minLog) / (maxLog - minLog) * plotWidth);
  const title = metric === "magnitude" ? "Magnitude (dB)" : "Phase (degrees)";
  const xTicks = xTickValues(frequenciesHz);
  const grid: string[] = [];
  const labels: string[] = [];

  grid.push(`<rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="#10141c" stroke="#303d4f"/>`);
  for (const frequency of xTicks) {
    const tickX = x(frequency);
    grid.push(`<line x1="${tickX.toFixed(2)}" y1="${top}" x2="${tickX.toFixed(2)}" y2="${top + plotHeight}" stroke="#263243"/>`);
    labels.push(`<text x="${tickX.toFixed(2)}" y="${top + plotHeight + 18}" fill="#aebbd0" font-size="11" text-anchor="middle">${escapeText(formatValue(frequency, "Hz"))}</text>`);
  }

  let yForValue: (value: number) => number;
  if (metric === "magnitude") {
    // Do not spread all samples into Math.min/max: supported multi-probe
    // sweeps can exceed the engine's function-argument limit.
    let maximum = 0;
    let minimum = Infinity;
    for (const entry of series) {
      for (const sample of entry.magnitude) {
        const value = magnitudeDb(sample);
        maximum = Math.max(maximum, value);
        minimum = Math.min(minimum, value);
      }
    }
    minimum = Math.min(maximum - 20, minimum);
    const step = niceDbStep(maximum - minimum);
    const minDb = Math.floor(minimum / step) * step;
    const maxDb = Math.max(minDb + step * 2, Math.ceil(maximum / step) * step);
    yForValue = (value) => top + (maxDb - value) / (maxDb - minDb) * plotHeight;
    for (let value = minDb; value <= maxDb; value += step) {
      const tickY = yForValue(value);
      grid.push(`<line x1="${left}" y1="${tickY.toFixed(2)}" x2="${left + plotWidth}" y2="${tickY.toFixed(2)}" stroke="#263243"/>`);
      labels.push(`<text x="${left - 10}" y="${(tickY + 4).toFixed(2)}" fill="#aebbd0" font-size="11" text-anchor="end">${value}</text>`);
    }
  } else {
    yForValue = (value) => top + (180 - clamp(value, -180, 180)) / 360 * plotHeight;
    for (const value of [-180, -90, 0, 90, 180]) {
      const tickY = yForValue(value);
      grid.push(`<line x1="${left}" y1="${tickY.toFixed(2)}" x2="${left + plotWidth}" y2="${tickY.toFixed(2)}" stroke="#263243"/>`);
      labels.push(`<text x="${left - 10}" y="${(tickY + 4).toFixed(2)}" fill="#aebbd0" font-size="11" text-anchor="end">${value}°</text>`);
    }
  }

  const sampled = sampledIndices(frequenciesHz.length);
  const paths: string[] = [];
  for (const [seriesIndex, entry] of series.entries()) {
    const points: string[] = [];
    for (const index of sampled) {
      const frequency = frequenciesHz[index];
      if (frequency === undefined) continue;
      const raw = metric === "magnitude" ? magnitudeDb(entry.magnitude[index] ?? 0) : entry.phaseDegrees[index] ?? 0;
      if (!Number.isFinite(raw)) continue;
      points.push(`${x(frequency).toFixed(2)},${yForValue(raw).toFixed(2)}`);
    }
    if (points.length > 1) {
      paths.push(`<polyline points="${points.join(" ")}" fill="none" stroke="${entry.color}" stroke-dasharray="${AC_DASHES[seriesIndex % AC_DASHES.length]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><title>${escapeText(entry.label)}</title></polyline>`);
    }
  }

  const cursorX = acCursorX(geometry, cursorIndex);
  const cursor = `<line class="ac-cursor" x1="${cursorX.toFixed(2)}" y1="${top}" x2="${cursorX.toFixed(2)}" y2="${top + plotHeight}" stroke="#f9c974" stroke-width="1" stroke-dasharray="4 4"/>`;
  const svg = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="AC ${metric} response" xmlns="http://www.w3.org/2000/svg">` +
    `<text x="${left}" y="17" fill="#eef2f9" font-size="12" font-weight="600">${title}</text>` +
    grid.join("") + paths.join("") + cursor + labels.join("") +
    `<text x="${left + plotWidth / 2}" y="${HEIGHT - 4}" fill="#aebbd0" font-size="11" text-anchor="middle">Frequency (Hz, logarithmic)</text>` +
    `</svg>`;
  return { svg, geometry };
}
