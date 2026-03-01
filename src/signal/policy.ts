import {
  DataMaturity,
  DetectorDecision,
  SignalSchema,
  StrategyKind,
} from './contracts';

const ALLOWED_STRATEGIES: Record<DataMaturity, StrategyKind[]> = {
  [DataMaturity.INSUFFICIENT]: [],
  [DataMaturity.FAST]: [
    'OrderFlowReversal',
    'LiquidityGrab',
    'VWAPReversion',
    'HtfBiasLtfOrderFlow',
  ],
  [DataMaturity.INTRADAY]: [
    'OrderFlowReversal',
    'LiquidityGrab',
    'VWAPReversion',
    'RegimeTrendContinuation',
    'HtfBiasLtfOrderFlow',
    'LiquiditySweepReversal',
    'TrendPullback',
  ],
  [DataMaturity.FULL]: [
    'OrderFlowReversal',
    'LiquidityGrab',
    'VWAPReversion',
    'RegimeTrendContinuation',
    'HtfBiasLtfOrderFlow',
    'LiquiditySweepReversal',
    'TrendPullback',
  ],
};

export function applyMaturityPolicy(signal: SignalSchema): SignalSchema {
  const maturity = signal.context.dataMaturity;
  const allowed = ALLOWED_STRATEGIES[maturity];
  const rejectedBy = [...signal.audit.rejectedBy];

  if (signal.decision === DetectorDecision.NO_TRADE) {
    return signal;
  }

  if (!signal.strategy || !allowed.includes(signal.strategy)) {
    return {
      ...signal,
      decision: DetectorDecision.NO_TRADE,
      confidence: 0,
      direction: undefined,
      entry: undefined,
      stop: undefined,
      targets: [],
      audit: {
        ...signal.audit,
        rejectedBy: [...rejectedBy, `MaturityStrategyGuard:${maturity}`],
      },
    };
  }

  if (maturity === DataMaturity.FAST) {
    // FAST режим допускает сигналы, но с верхним потолком уверенности (консервативно),
    // при этом не ниже базового порога валидатора (0.6).
    const cappedConfidence = Math.min(signal.confidence, 0.6);
    return {
      ...signal,
      confidence: cappedConfidence,
      targets: signal.targets.slice(0, 1),
      audit: {
        ...signal.audit,
        rejectedBy,
      },
    };
  }

  return signal;
}
