import {
  ContextDetectorResult,
  DetectorDecision,
  DetectorInput,
  DetectorNode,
  DetectorRole,
  SignalSchema,
  TriggerDetectorResult,
} from './contracts';
import { applyMaturityPolicy } from './policy';
import { buildHtfRangeRisk, ZoneRange } from './risk/htf-range-risk';
import { SignalValidator } from './validator';

export class DetectorPipeline {
  private readonly contextDetectors: Array<DetectorNode<ContextDetectorResult>>;
  private readonly triggerDetectors: Array<DetectorNode<TriggerDetectorResult>>;

  constructor(
    private readonly detectors: Array<
      DetectorNode<ContextDetectorResult | TriggerDetectorResult>
    >,
    private readonly validator = new SignalValidator(),
  ) {
    this.contextDetectors = this.detectors.filter(
      d => d.role === DetectorRole.CONTEXT || d.role === DetectorRole.ZONE,
    ) as Array<DetectorNode<ContextDetectorResult>>;
    this.triggerDetectors = this.detectors.filter(
      d => d.role === DetectorRole.TRIGGER,
    ) as Array<DetectorNode<TriggerDetectorResult>>;
  }

  execute(input: DetectorInput): SignalSchema {
    const contextResults = this.contextDetectors
      .map(detector => detector.evaluate(input))
      .filter(result => result.fired);

    const triggerResults = this.triggerDetectors
      .map(detector => detector.evaluate(input))
      .filter(result => result.fired);

    const mergedContext = this.mergeContext(contextResults);
    const candidates = [...triggerResults].sort((a, b) => b.confidence - a.confidence);

    const { chosenTrigger, gateRejectedBy } = this.pickBestTrigger({
      input,
      context: mergedContext,
      candidates,
    });

    const bestTrigger = chosenTrigger;
    const baseSignal: SignalSchema = {
      decision: bestTrigger ? DetectorDecision.TRADE : DetectorDecision.NO_TRADE,
      symbol: input.instrument.symbol,
      market: input.instrument.marketType,
      direction: bestTrigger?.direction,
      confidence: bestTrigger?.confidence ?? 0,
      strategy: bestTrigger?.strategy,
      entry: bestTrigger?.entryPrice
        ? {
            price: bestTrigger.entryPrice,
            type: 'limit',
            reason: bestTrigger.reason ?? 'trigger-detector',
          }
        : undefined,
      stop: bestTrigger?.stopPrice
        ? { price: bestTrigger.stopPrice, reason: 'trigger-stop' }
        : undefined,
      targets: bestTrigger?.targets ?? [],
      context: {
        regime: mergedContext.regime ?? 'unknown',
        bias: mergedContext.bias,
        delta: input.orderFlow.deltaRatio,
        orderBookImbalance: input.orderBook.imbalance,
        dataMaturity: input.dataContext.maturity,
      },
      audit: {
        detectorsFired: [
          ...contextResults.map(x => x.detector),
          ...triggerResults.map(x => x.detector),
        ],
        rejectedBy: gateRejectedBy,
        inputsRef: {
          candlesKey: input.candles.cacheKey,
          flowKey: input.orderFlow.snapshotKey,
          bookKey: input.orderBook.snapshotKey,
        },
      },
    };

    const riskAdjusted = this.applyRiskManager(baseSignal, mergedContext);
    const policySignal = applyMaturityPolicy(riskAdjusted);
    const validation = this.validator.validate(policySignal);

    if (!validation.accepted) {
      return {
        ...policySignal,
        decision: DetectorDecision.NO_TRADE,
        confidence: 0,
        direction: undefined,
        entry: undefined,
        stop: undefined,
        targets: [],
        audit: {
          ...policySignal.audit,
          rejectedBy: [
            ...policySignal.audit.rejectedBy,
            ...validation.rejectedBy,
            `RR:${validation.rr.toFixed(2)}`,
          ],
        },
      };
    }

    return policySignal;
  }

  private mergeContext(results: ContextDetectorResult[]): {
    regime?: string;
    bias?: ContextDetectorResult['bias'];
    levelsDetailed?: Record<string, number>;
    zones: ZoneRange[];
  } {
    const levelsDetailed: Record<string, number> = {};
    const zones: ZoneRange[] = [];

    for (const r of results) {
      if (r.levelsDetailed) {
        for (const [k, v] of Object.entries(r.levelsDetailed)) {
          const n = Number(v);
          if (Number.isFinite(n)) levelsDetailed[k] = n;
        }
      }
      if (r.zonesDetailed) {
        for (const z of r.zonesDetailed) {
          if (!z || !Array.isArray(z.range) || z.range.length !== 2) continue;
          const a = Number(z.range[0]);
          const b = Number(z.range[1]);
          if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
          zones.push({ type: String(z.type ?? 'ZONE'), range: [a, b] });
        }
      }
    }

    const contextLike = results.find(r => r.bias || r.regime) ?? results[0];

    return {
      regime: contextLike?.regime,
      bias: contextLike?.bias,
      levelsDetailed: Object.keys(levelsDetailed).length ? levelsDetailed : undefined,
      zones,
    };
  }

  private pickBestTrigger(args: {
    input: DetectorInput;
    context: { bias?: ContextDetectorResult['bias']; zones: ZoneRange[] };
    candidates: TriggerDetectorResult[];
  }): { chosenTrigger?: TriggerDetectorResult; gateRejectedBy: string[] } {
    const rejected: string[] = [];

    for (const t of args.candidates) {
      const entry = Number(t.entryPrice ?? this.mid(args.input));
      const dir = t.direction;
      const bias = args.context.bias;

      if (!dir) {
        rejected.push(`${t.detector}:NoDirection`);
        continue;
      }

      if (bias && bias !== 'NEUTRAL' && bias !== dir) {
        rejected.push(`${t.detector}:BiasMismatch:${bias}->${dir}`);
        continue;
      }

      if (bias === 'NEUTRAL') {
        const allowNeutral =
          t.strategy === 'LiquiditySweepReversal' && (t.confidence ?? 0) >= 0.7;
        if (!allowNeutral) {
          rejected.push(`${t.detector}:NeutralBiasGuard`);
          continue;
        }
      }

      if (args.context.zones.length > 0 && !this.inAnyZone(entry, args.context.zones)) {
        rejected.push(`${t.detector}:OutOfZone`);
        continue;
      }

      return { chosenTrigger: t, gateRejectedBy: rejected };
    }

    return { gateRejectedBy: rejected };
  }

  private applyRiskManager(
    signal: SignalSchema,
    context: { zones: ZoneRange[]; levelsDetailed?: Record<string, number> },
  ): SignalSchema {
    if (signal.decision !== DetectorDecision.TRADE) return signal;
    if (!signal.entry || !signal.direction) return signal;
    if (!context.zones.length) {
      return {
        ...signal,
        audit: {
          ...signal.audit,
          rejectedBy: [...signal.audit.rejectedBy, 'Risk:NoZones'],
        },
      };
    }

    const risk = buildHtfRangeRisk({
      direction: signal.direction,
      entry: signal.entry.price,
      zones: context.zones,
      levels: context.levelsDetailed,
    });

    if (!risk) {
      return {
        ...signal,
        audit: {
          ...signal.audit,
          rejectedBy: [...signal.audit.rejectedBy, 'Risk:NotComputed'],
        },
      };
    }

    return {
      ...signal,
      stop: { price: risk.stop, reason: 'htf-zone-stop' },
      targets: risk.targets.map(price => ({ price, reason: 'htf-range-target' })),
      audit: {
        ...signal.audit,
        rejectedBy: [...signal.audit.rejectedBy, `RiskRR:${risk.rr.toFixed(2)}`],
      },
    };
  }

  private mid(input: DetectorInput): number {
    const bestBid = Number(input.orderBook.bestBid ?? 0);
    const bestAsk = Number(input.orderBook.bestAsk ?? 0);
    const mid = Number(input.orderBook.mid ?? 0) || (bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0);
    return Number.isFinite(mid) ? mid : 0;
  }

  private inAnyZone(x: number, zones: ZoneRange[]): boolean {
    if (!Number.isFinite(x) || x <= 0) return false;
    for (const z of zones) {
      const [a, b] = z.range;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (x >= lo && x <= hi) return true;
    }
    return false;
  }
}
