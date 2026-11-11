const MULTIPLIERS: Record<string, number> = { "": 1, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };

export function parseValue(text: string): number {
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([pnuµμmkKMG]?)\s*(?:Ω|ohms?|V|A|F|H|s|Hz)?\s*$/i.exec(text);
  if (!match || !(match[2]! in MULTIPLIERS)) throw new Error("Enter a number with an optional SI prefix, e.g. 1k or 4.7u.");
  const value = Number(match[1]) * MULTIPLIERS[match[2]!]!;
  if (!Number.isFinite(value)) throw new Error("Enter a finite number.");
  return value;
}

export function formatValue(value: number, unit = ""): string {
  if (!Number.isFinite(value)) return "Unavailable";
  const absolute = Math.abs(value);
  const prefixes: [number, string][] = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  const [scale, prefix] = value === 0 ? [1, ""] as const : prefixes.find(([scale]) => absolute >= scale) ?? [1e-12, "p"];
  return `${Number((value / scale).toPrecision(6))} ${prefix}${unit}`.trim();
}
