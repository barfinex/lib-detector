import { MarketType } from '@barfinex/types';
import {
  ContextBiasDetector,
  DetectorPipeline,
  HtfRangeZoneDetector,
  TriggerAbsorptionDetector,
} from './index';
import { DataMaturity, DetectorDecision, DetectorInput } from './contracts';

function series(args: { len: number; start: number; step: number; startTime: number; stepMs: number }) {
  const out: Array<{ time: number; close: number }> = [];
  for (let i = 0; i < args.len; i += 1) {
    out.push({
      time: args.startTime + i * args.stepMs,
      close: args.start + i * args.step,
    });
  }
  return out;
}

function baseInput(overrides: Partial<DetectorInput> = {}): DetectorInput {
  return {
    instrument: { symbol: 'BTCUSDT', connectorType: 'binance' as any, marketType: MarketType.futures },
    dataContext: {
      maturity: DataMaturity.FULL,
      windows: { candlesDays: 365, flowMinutes: 3, bookMinutes: 1 },
    },
    candles: {
      cacheKey: 'candles:test',
      d1: series({ len: 90, start: 100, step: 0.2, startTime: 1_700_000_000_000, stepMs: 86_400_000 }),
      h4: series({ len: 240, start: 100, step: 0.08, startTime: 1_700_000_000_000, stepMs: 14_400_000 }),
      h1: series({ len: 240, start: 100, step: 0.03, startTime: 1_700_000_000_000, stepMs: 3_600_000 }),
    },
    orderFlow: {
      snapshotKey: 'flow:test',
      shortWindowSec: 10,
      longWindowSec: 180,
      deltaRatio: 0.35,
      cvd: -120,
      aggressiveBuyVolume: 120,
      aggressiveSellVolume: 240,
      absorptionScore: 0.12,
    },
    orderBook: {
      snapshotKey: 'book:test',
      depth: 50,
      imbalance: 1.2,
      bestBid: 100.0,
      bestAsk: 100.1,
    },
    ...overrides,
  };
}

describe('DetectorPipeline gating + HTF risk', () => {
  const pipeline = new DetectorPipeline([
    new ContextBiasDetector(),
    new HtfRangeZoneDetector(),
    new TriggerAbsorptionDetector(),
  ]);

  it('TRADE when bias aligns and entry is in zone', () => {
    const input = baseInput();
    const signal = pipeline.execute(input);
    expect(signal.decision).toBe(DetectorDecision.TRADE);
    expect(signal.direction).toBe('LONG');
    expect(signal.entry?.price).toBeGreaterThan(0);
    expect(signal.stop?.price).toBeGreaterThan(0);
    expect(signal.targets.length).toBeGreaterThan(0);
  });

  it('NO_TRADE when trigger conflicts with HTF bias', () => {
    const input = baseInput({
      candles: {
        cacheKey: 'candles:down',
        // downtrend: last close below older close
        d1: series({ len: 90, start: 120, step: -0.2, startTime: 1_700_000_000_000, stepMs: 86_400_000 }),
        h4: series({ len: 240, start: 120, step: -0.08, startTime: 1_700_000_000_000, stepMs: 14_400_000 }),
        h1: series({ len: 240, start: 120, step: -0.03, startTime: 1_700_000_000_000, stepMs: 3_600_000 }),
      },
    });
    const signal = pipeline.execute(input);
    expect(signal.decision).toBe(DetectorDecision.NO_TRADE);
    expect(signal.audit.rejectedBy.join(',')).toContain('BiasMismatch');
  });

  it('NO_TRADE when price is outside any zone', () => {
    const input = baseInput({
      orderBook: {
        snapshotKey: 'book:mid',
        depth: 50,
        imbalance: 1.2,
        bestBid: 110.0,
        bestAsk: 110.1,
      },
    });
    const signal = pipeline.execute(input);
    expect(signal.decision).toBe(DetectorDecision.NO_TRADE);
    expect(signal.audit.rejectedBy.join(',')).toContain('OutOfZone');
  });
});

