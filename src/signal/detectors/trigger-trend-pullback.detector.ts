import {
  DetectorInput,
  DetectorNode,
  DetectorRole,
  TriggerDetectorResult,
} from '../contracts';

export class TriggerTrendPullbackDetector implements DetectorNode<TriggerDetectorResult> {
  readonly name = 'TriggerTrendPullbackDetector';
  readonly role = DetectorRole.TRIGGER;

  evaluate(input: DetectorInput): TriggerDetectorResult {
    const h4 = input.candles.h4 ?? [];
    const d1 = input.candles.d1 ?? [];
    if (h4.length < 30 || d1.length < 10) {
      return { fired: false, detector: this.name, strategy: 'TrendPullback', confidence: 0 };
    }

    const h4Mom = this.momentum(h4, 18);
    const d1Mom = this.momentum(d1, 6);
    const trendUp = h4Mom > 0 && d1Mom > 0;
    const trendDown = h4Mom < 0 && d1Mom < 0;
    if (!trendUp && !trendDown) {
      return { fired: false, detector: this.name, strategy: 'TrendPullback', confidence: 0 };
    }

    const bestBid = Number(input.orderBook.bestBid ?? 0);
    const bestAsk = Number(input.orderBook.bestAsk ?? 0);
    const mid =
      Number(input.orderBook.mid ?? 0) || (bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0);
    if (!Number.isFinite(mid) || mid <= 0) {
      return { fired: false, detector: this.name, strategy: 'TrendPullback', confidence: 0 };
    }

    const pullbackLevel = this.swingMid(h4.slice(-60));
    if (pullbackLevel == null) {
      return { fired: false, detector: this.name, strategy: 'TrendPullback', confidence: 0 };
    }

    const delta = Number(input.orderFlow.deltaRatio ?? 0.5);
    const imbalance = Number(input.orderBook.imbalance ?? 1);
    const absorption = Number(input.orderFlow.absorptionScore ?? 0);

    const nearPullback = Math.abs(mid - pullbackLevel) / pullbackLevel < 0.006;

    const longSignal =
      trendUp && nearPullback && delta >= 0.55 && imbalance >= 1.05 && absorption >= 0.06;
    const shortSignal =
      trendDown && nearPullback && delta <= 0.45 && imbalance <= 0.95 && absorption >= 0.06;

    if (!longSignal && !shortSignal) {
      return { fired: false, detector: this.name, strategy: 'TrendPullback', confidence: 0 };
    }

    const direction = longSignal ? 'LONG' : 'SHORT';
    const confidence = this.clamp01(
      0.6 +
        Math.abs(delta - 0.5) * 0.55 +
        Math.abs(imbalance - 1) * 0.25 +
        Math.min(0.25, absorption) * 0.6,
    );

    return {
      fired: true,
      detector: this.name,
      strategy: 'TrendPullback',
      direction,
      confidence,
      reason: `pullback@${pullbackLevel.toFixed(2)}, delta=${delta.toFixed(
        2,
      )}, imbalance=${imbalance.toFixed(2)}`,
      entryPrice: mid,
    };
  }

  private clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  private momentum(list: Array<{ close: number }>, lookback: number): number {
    const n = Math.min(lookback, list.length - 1);
    if (n <= 0) return 0;
    const a = Number(list[list.length - 1]?.close ?? NaN);
    const b = Number(list[list.length - 1 - n]?.close ?? NaN);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return a - b;
  }

  private swingMid(list: Array<{ close: number; high?: number; low?: number }>): number | null {
    let hi = -Infinity;
    let lo = Infinity;
    for (const c of list) {
      const high = Number(c.high ?? c.close);
      const low = Number(c.low ?? c.close);
      if (Number.isFinite(high)) hi = Math.max(hi, high);
      if (Number.isFinite(low)) lo = Math.min(lo, low);
    }
    if (hi === -Infinity || lo === Infinity) return null;
    return (hi + lo) / 2;
  }
}

