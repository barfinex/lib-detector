import { MarketType } from '@barfinex/types';
import { applyMaturityPolicy } from './policy';
import { DataMaturity, DetectorDecision, SignalSchema } from './contracts';
import { SignalValidator } from './validator';

function makeTradeSignal(maturity: DataMaturity): SignalSchema {
  return {
    decision: DetectorDecision.TRADE,
    symbol: 'BTCUSDT',
    market: MarketType.futures,
    direction: 'LONG',
    confidence: 0.72,
    strategy: 'OrderFlowReversal',
    entry: { price: 100, type: 'limit', reason: 'test' },
    stop: { price: 99, reason: 'test' },
    targets: [{ price: 102.4, reason: 'test' }],
    context: {
      regime: 'trend',
      bias: 'LONG',
      delta: 0.7,
      orderBookImbalance: 1.2,
      dataMaturity: maturity,
    },
    audit: {
      detectorsFired: ['ContextBiasDetector', 'TriggerImbalanceDetector'],
      rejectedBy: [],
      inputsRef: {
        candlesKey: 'candles:btc',
        flowKey: 'flow:btc',
        bookKey: 'book:btc',
      },
    },
  };
}

describe('Signal policy and validator', () => {
  it('rejects when RR is below threshold', () => {
    const validator = new SignalValidator(2, 0.6);
    const signal = makeTradeSignal(DataMaturity.FULL);
    signal.targets = [{ price: 101, reason: 'small target' }];

    const result = validator.validate(signal);
    expect(result.accepted).toBe(false);
    expect(result.rejectedBy).toContain('RiskRewardBelowThreshold:1.00');
  });

  it('FAST maturity caps confidence and keeps short target', () => {
    const fastSignal = makeTradeSignal(DataMaturity.FAST);
    fastSignal.targets.push({ price: 104, reason: 'swing target' });

    const result = applyMaturityPolicy(fastSignal);
    expect(result.confidence).toBe(0.6);
    expect(result.targets.length).toBe(1);
  });

  it('FAST maturity rejects unavailable strategy', () => {
    const fastSignal = makeTradeSignal(DataMaturity.FAST);
    fastSignal.strategy = 'RegimeTrendContinuation';

    const result = applyMaturityPolicy(fastSignal);
    expect(result.decision).toBe(DetectorDecision.NO_TRADE);
    expect(result.audit.rejectedBy).toContain('MaturityStrategyGuard:FAST');
  });
});
