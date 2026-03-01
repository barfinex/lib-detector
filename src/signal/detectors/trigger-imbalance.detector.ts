import {
  DetectorInput,
  DetectorNode,
  DetectorRole,
  TriggerDetectorResult,
} from '../contracts';

export class TriggerImbalanceDetector
  implements DetectorNode<TriggerDetectorResult>
{
  readonly name = 'TriggerImbalanceDetector';
  readonly role = DetectorRole.TRIGGER;

  evaluate(input: DetectorInput): TriggerDetectorResult {
    const delta = input.orderFlow.deltaRatio;
    const imbalance = input.orderBook.imbalance;
    const mid = (input.orderBook.bestBid + input.orderBook.bestAsk) / 2;

    const longSignal = delta >= 0.62 && imbalance >= 1.15;
    const shortSignal = delta <= 0.38 && imbalance <= 0.87;

    if (!longSignal && !shortSignal) {
      return {
        fired: false,
        detector: this.name,
        strategy: 'OrderFlowReversal',
        confidence: 0,
      };
    }

    const direction = longSignal ? 'LONG' : 'SHORT';
    const stopDistance = mid * 0.003;
    const entryPrice = mid;
    const stopPrice =
      direction === 'LONG' ? mid - stopDistance : mid + stopDistance;
    const targetPrice =
      direction === 'LONG' ? mid + stopDistance * 2.4 : mid - stopDistance * 2.4;

    const confidence = Math.min(
      0.9,
      0.6 + Math.abs(delta - 0.5) + Math.abs(imbalance - 1) * 0.2,
    );

    return {
      fired: true,
      detector: this.name,
      strategy: 'OrderFlowReversal',
      direction,
      confidence,
      reason: `delta=${delta.toFixed(2)}, imbalance=${imbalance.toFixed(2)}`,
      entryPrice,
      stopPrice,
      targets: [
        {
          price: targetPrice,
          reason: 'orderflow continuation target',
        },
      ],
    };
  }
}
