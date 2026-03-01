import {
  ContextDetectorResult,
  DataMaturity,
  DetectorInput,
  DetectorNode,
  DetectorRole,
} from '../contracts';

export class ContextBiasDetector
  implements DetectorNode<ContextDetectorResult>
{
  readonly name = 'ContextBiasDetector';
  readonly role = DetectorRole.CONTEXT;

  evaluate(input: DetectorInput): ContextDetectorResult {
    const d1 = input.candles.d1 ?? [];
    const h4 = input.candles.h4 ?? [];
    const h1 = input.candles.h1 ?? [];

    if (d1.length < 5 || h4.length < 5) {
      return { fired: false, detector: this.name };
    }

    const d1Momentum = this.momentum(d1, 5);
    const h4Momentum = this.momentum(h4, 8);
    const h1Momentum = h1.length >= 8 ? this.momentum(h1, 8) : 0;

    if (Math.sign(d1Momentum) !== Math.sign(h4Momentum)) {
      return {
        fired: true,
        detector: this.name,
        regime: 'transition',
        bias: 'NEUTRAL',
        levelsDetailed: this.computeLevels({ d1, h4 }),
      };
    }

    const bias = d1Momentum >= 0 ? 'LONG' : 'SHORT';
    const d1Range = this.normRange(d1, 20);
    const h4Range = this.normRange(h4, 40);
    const rangeLike = d1Range < 0.035 && h4Range < 0.03 && Math.abs(h1Momentum) < Math.abs(h4Momentum) * 0.6;

    const regime = rangeLike
      ? 'range'
      : input.dataContext.maturity === DataMaturity.FULL
        ? 'trend'
        : 'intraday-trend';

    return {
      fired: true,
      detector: this.name,
      regime,
      bias,
      levels: [
        this.lastClose(d1),
        this.lastClose(h4),
      ].filter((x): x is number => Number.isFinite(x)),
      levelsDetailed: this.computeLevels({ d1, h4 }),
      zones: ['HTF_RANGE'],
    };
  }

  private lastClose(list: Array<{ close: number }>): number | null {
    if (!list.length) return null;
    const x = Number(list[list.length - 1]?.close ?? NaN);
    return Number.isFinite(x) ? x : null;
  }

  private momentum(list: Array<{ close: number }>, lookback: number): number {
    const n = Math.min(lookback, list.length - 1);
    if (n <= 0) return 0;
    const a = Number(list[list.length - 1]?.close ?? NaN);
    const b = Number(list[list.length - 1 - n]?.close ?? NaN);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return a - b;
  }

  private normRange(
    list: Array<{ close: number; high?: number; low?: number }>,
    maxBars: number,
  ): number {
    const slice = list.slice(Math.max(0, list.length - maxBars));
    if (slice.length < 3) return 0;
    let hi = -Infinity;
    let lo = Infinity;
    let sum = 0;
    for (const c of slice) {
      const high = Number(c.high ?? c.close);
      const low = Number(c.low ?? c.close);
      const close = Number(c.close);
      if (Number.isFinite(high)) hi = Math.max(hi, high);
      if (Number.isFinite(low)) lo = Math.min(lo, low);
      if (Number.isFinite(close)) sum += close;
    }
    const avg = sum / Math.max(1, slice.length);
    if (!Number.isFinite(avg) || avg <= 0) return 0;
    const range = hi > lo ? hi - lo : 0;
    return range / avg;
  }

  private computeLevels(args: {
    d1: Array<{ close: number; high?: number; low?: number }>;
    h4: Array<{ close: number; high?: number; low?: number }>;
  }): Record<string, number> {
    const d1 = args.d1.slice(Math.max(0, args.d1.length - 60));
    const h4 = args.h4.slice(Math.max(0, args.h4.length - 120));
    const d1Hi = this.maxHigh(d1);
    const d1Lo = this.minLow(d1);
    const h4Hi = this.maxHigh(h4);
    const h4Lo = this.minLow(h4);
    const d1Mid = d1Hi != null && d1Lo != null ? (d1Hi + d1Lo) / 2 : null;
    const h4Mid = h4Hi != null && h4Lo != null ? (h4Hi + h4Lo) / 2 : null;

    const out: Record<string, number> = {};
    if (d1Hi != null) out.d1High = d1Hi;
    if (d1Lo != null) out.d1Low = d1Lo;
    if (d1Mid != null) out.d1Mid = d1Mid;
    if (h4Hi != null) out.h4High = h4Hi;
    if (h4Lo != null) out.h4Low = h4Lo;
    if (h4Mid != null) out.h4Mid = h4Mid;
    return out;
  }

  private maxHigh(list: Array<{ close: number; high?: number }>): number | null {
    let v = -Infinity;
    for (const c of list) {
      const x = Number(c.high ?? c.close);
      if (Number.isFinite(x)) v = Math.max(v, x);
    }
    return v === -Infinity ? null : v;
  }

  private minLow(list: Array<{ close: number; low?: number }>): number | null {
    let v = Infinity;
    for (const c of list) {
      const x = Number(c.low ?? c.close);
      if (Number.isFinite(x)) v = Math.min(v, x);
    }
    return v === Infinity ? null : v;
  }
}
