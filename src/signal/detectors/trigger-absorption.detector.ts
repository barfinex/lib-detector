import {
  DetectorInput,
  DetectorNode,
  DetectorRole,
  TriggerDetectorResult,
} from '../contracts';

export class TriggerAbsorptionDetector implements DetectorNode<TriggerDetectorResult> {
  readonly name = 'TriggerAbsorptionDetector';
  readonly role = DetectorRole.TRIGGER;

  evaluate(input: DetectorInput): TriggerDetectorResult {
    const delta = Number(input.orderFlow.deltaRatio ?? 0.5);
    const imbalance = Number(input.orderBook.imbalance ?? 1);
    const absorption = Number(input.orderFlow.absorptionScore ?? 0);

    const bestBid = Number(input.orderBook.bestBid ?? 0);
    const bestAsk = Number(input.orderBook.bestAsk ?? 0);
    const mid =
      Number(input.orderBook.mid ?? 0) || (bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0);
    const spreadPct =
      Number(input.orderBook.spreadPct ?? 0) ||
      (bestBid > 0 && bestAsk > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : 0);

    // Фильтр: если спред слишком большой — это часто шум/плохая ликвидность.
    if (spreadPct > 0.25 || mid <= 0) {
      return {
        fired: false,
        detector: this.name,
        strategy: 'HtfBiasLtfOrderFlow',
        confidence: 0,
      };
    }

    // Bullish absorption: продавцов много, а цена держится (поддержка в стакане).
    const longSignal = delta <= 0.4 && imbalance >= 1.12 && absorption >= 0.1;

    // Bearish absorption: покупателей много, а цена не растёт (оффер держит).
    const shortSignal = delta >= 0.6 && imbalance <= 0.9 && absorption >= 0.1;

    if (!longSignal && !shortSignal) {
      return {
        fired: false,
        detector: this.name,
        strategy: 'HtfBiasLtfOrderFlow',
        confidence: 0,
      };
    }

    const direction = longSignal ? 'LONG' : 'SHORT';
    const confidence = this.clamp01(
      0.58 +
        Math.abs(delta - 0.5) * 0.7 +
        Math.abs(imbalance - 1) * 0.25 +
        Math.min(0.25, absorption) * 0.6,
    );

    return {
      fired: true,
      detector: this.name,
      strategy: 'HtfBiasLtfOrderFlow',
      direction,
      confidence,
      reason: `absorption=${absorption.toFixed(2)}, delta=${delta.toFixed(
        2,
      )}, imbalance=${imbalance.toFixed(2)}`,
      entryPrice: mid,
    };
  }

  private clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }
}

