import { SignalDirection } from '../contracts';

export type ZoneRange = { type: string; range: [number, number] };

export function buildHtfRangeRisk(args: {
  direction: SignalDirection;
  entry: number;
  zones: ZoneRange[];
  levels?: Record<string, number>;
}): { stop: number; targets: number[]; rr: number } | null {
  const { direction, entry, zones, levels } = args;
  if (!Number.isFinite(entry) || entry <= 0) return null;

  const preferredType = direction === 'LONG' ? 'HTF_LOW' : 'HTF_HIGH';
  const containing = zones.filter(z => inRange(entry, z.range));
  const preferred =
    containing.find(z => z.type === preferredType) ??
    containing[0] ??
    zones.find(z => z.type === preferredType) ??
    null;

  if (!preferred) return null;

  const [zLo, zHi] = sortRange(preferred.range);
  const zoneWidth = Math.max(1e-9, zHi - zLo);
  const buffer = zoneWidth * 0.15;

  const stop =
    direction === 'LONG'
      ? zLo - buffer
      : zHi + buffer;

  const htfHigh = levels?.htfHigh ?? levels?.d1High ?? levels?.h4High;
  const htfLow = levels?.htfLow ?? levels?.d1Low ?? levels?.h4Low;
  const htfMid =
    levels?.htfMid ??
    (Number.isFinite(htfHigh) && Number.isFinite(htfLow) ? (Number(htfHigh) + Number(htfLow)) / 2 : undefined);

  const tp1 =
    typeof htfMid === 'number' && Number.isFinite(htfMid) && htfMid > 0
      ? htfMid
      : direction === 'LONG'
        ? entry + Math.abs(entry - stop) * 2
        : entry - Math.abs(entry - stop) * 2;

  const tp2 =
    direction === 'LONG'
      ? (typeof htfHigh === 'number' && Number.isFinite(htfHigh) && htfHigh > 0 ? htfHigh : entry + Math.abs(entry - stop) * 3)
      : (typeof htfLow === 'number' && Number.isFinite(htfLow) && htfLow > 0 ? htfLow : entry - Math.abs(entry - stop) * 3);

  const targets = dedupeTargets(direction, [tp1, tp2].filter(x => Number.isFinite(x) && x > 0) as number[], entry);
  if (!targets.length) return null;

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(targets[0] - entry);
  const rr = risk > 0 ? reward / risk : 0;

  return { stop, targets, rr };
}

function inRange(x: number, r: [number, number]): boolean {
  const [a, b] = r;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return x >= lo && x <= hi;
}

function sortRange(r: [number, number]): [number, number] {
  return r[0] <= r[1] ? r : [r[1], r[0]];
}

function dedupeTargets(direction: SignalDirection, list: number[], entry: number): number[] {
  const uniq = Array.from(new Set(list.map(x => Number(x))));
  const filtered =
    direction === 'LONG' ? uniq.filter(x => x > entry) : uniq.filter(x => x < entry);
  const sorted = filtered.sort((a, b) => (direction === 'LONG' ? a - b : b - a));
  return sorted.slice(0, 3);
}

