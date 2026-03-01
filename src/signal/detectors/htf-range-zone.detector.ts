import {
  ContextDetectorResult,
  DetectorInput,
  DetectorNode,
  DetectorRole,
} from '../contracts';

export class HtfRangeZoneDetector implements DetectorNode<ContextDetectorResult> {
  readonly name = 'HtfRangeZoneDetector';
  readonly role = DetectorRole.ZONE;

  evaluate(input: DetectorInput): ContextDetectorResult {
    const d1 = input.candles.d1 ?? [];
    const h4 = input.candles.h4 ?? [];
    if (d1.length < 10 || h4.length < 10) {
      return { fired: false, detector: this.name };
    }

    const d1Hi = this.maxHigh(d1.slice(-90));
    const d1Lo = this.minLow(d1.slice(-90));
    const h4Hi = this.maxHigh(h4.slice(-240));
    const h4Lo = this.minLow(h4.slice(-240));

    if (d1Hi == null || d1Lo == null || h4Hi == null || h4Lo == null) {
      return { fired: false, detector: this.name };
    }

    const anchorHi = Math.max(d1Hi, h4Hi);
    const anchorLo = Math.min(d1Lo, h4Lo);
    const mid = (anchorHi + anchorLo) / 2;
    const range = anchorHi - anchorLo;
    const rangePct = mid > 0 ? range / mid : 0;

    // Ширина зоны зависит от ширины диапазона (простая институциональная эвристика).
    const zoneWidthPct = this.clamp(rangePct * 0.08, 0.0012, 0.0075);

    const lowZone: [number, number] = [
      anchorLo * (1 - zoneWidthPct),
      anchorLo * (1 + zoneWidthPct),
    ];
    const highZone: [number, number] = [
      anchorHi * (1 - zoneWidthPct),
      anchorHi * (1 + zoneWidthPct),
    ];

    return {
      fired: true,
      detector: this.name,
      zones: ['HTF_LOW', 'HTF_HIGH'],
      levelsDetailed: {
        htfHigh: anchorHi,
        htfLow: anchorLo,
        htfMid: mid,
      },
      zonesDetailed: [
        { type: 'HTF_LOW', range: lowZone, timeframe: 'd1', score: 0.7 },
        { type: 'HTF_HIGH', range: highZone, timeframe: 'd1', score: 0.7 },
      ],
    };
  }

  private clamp(x: number, lo: number, hi: number): number {
    if (!Number.isFinite(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
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

