import {
  DetectorInput,
  DetectorNode,
  DetectorRole,
  TriggerDetectorResult,
} from '../contracts';

export class TriggerLiquiditySweepDetector implements DetectorNode<TriggerDetectorResult> {
  readonly name = 'TriggerLiquiditySweepDetector';
  readonly role = DetectorRole.TRIGGER;

  evaluate(input: DetectorInput): TriggerDetectorResult {
    const d1 = input.candles.d1 ?? [];
    const h4 = input.candles.h4 ?? [];
    if (d1.length < 20 || h4.length < 40) {
      return { fired: false, detector: this.name, strategy: 'LiquiditySweepReversal', confidence: 0 };
    }

    const htfHigh = this.maxHigh(d1.slice(-180), h4.slice(-360));
    const htfLow = this.minLow(d1.slice(-180), h4.slice(-360));
    if (htfHigh == null || htfLow == null || htfHigh <= htfLow) {
      return { fired: false, detector: this.name, strategy: 'LiquiditySweepReversal', confidence: 0 };
    }

    const bestBid = Number(input.orderBook.bestBid ?? 0);
    const bestAsk = Number(input.orderBook.bestAsk ?? 0);
    const mid =
      Number(input.orderBook.mid ?? 0) || (bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0);
    if (!Number.isFinite(mid) || mid <= 0) {
      return { fired: false, detector: this.name, strategy: 'LiquiditySweepReversal', confidence: 0 };
    }

    const delta = Number(input.orderFlow.deltaRatio ?? 0.5);
    const imbalance = Number(input.orderBook.imbalance ?? 1);
    const absorption = Number(input.orderFlow.absorptionScore ?? 0);

    // Простая эвристика sweep+reclaim:
    // 1) цена вышла за HTF границу (sweep)
    // 2) flow/book подтверждают возврат (reclaim)
    const sweepBelow = mid < htfLow * 0.999;
    const sweepAbove = mid > htfHigh * 1.001;

    const bullishReclaim = sweepBelow && delta >= 0.55 && imbalance >= 1.08 && absorption >= 0.08;
    const bearishReclaim = sweepAbove && delta <= 0.45 && imbalance <= 0.93 && absorption >= 0.08;

    if (!bullishReclaim && !bearishReclaim) {
      return { fired: false, detector: this.name, strategy: 'LiquiditySweepReversal', confidence: 0 };
    }

    const direction = bullishReclaim ? 'LONG' : 'SHORT';
    const confidence = this.clamp01(
      0.6 +
        Math.abs(delta - 0.5) * 0.6 +
        Math.abs(imbalance - 1) * 0.25 +
        Math.min(0.25, absorption) * 0.7,
    );

    return {
      fired: true,
      detector: this.name,
      strategy: 'LiquiditySweepReversal',
      direction,
      confidence,
      reason: `sweep=${bullishReclaim ? 'below' : 'above'} HTF, delta=${delta.toFixed(
        2,
      )}, imbalance=${imbalance.toFixed(2)}`,
      entryPrice: mid,
    };
  }

  private clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  private maxHigh(
    a: Array<{ close: number; high?: number }>,
    b: Array<{ close: number; high?: number }>,
  ): number | null {
    let v = -Infinity;
    for (const c of [...a, ...b]) {
      const x = Number(c.high ?? c.close);
      if (Number.isFinite(x)) v = Math.max(v, x);
    }
    return v === -Infinity ? null : v;
  }

  private minLow(
    a: Array<{ close: number; low?: number }>,
    b: Array<{ close: number; low?: number }>,
  ): number | null {
    let v = Infinity;
    for (const c of [...a, ...b]) {
      const x = Number(c.low ?? c.close);
      if (Number.isFinite(x)) v = Math.min(v, x);
    }
    return v === Infinity ? null : v;
  }
}

