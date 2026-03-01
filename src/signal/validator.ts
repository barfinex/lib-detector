import { DetectorDecision, SignalSchema } from './contracts';

export interface ValidationResult {
  accepted: boolean;
  rr: number;
  rejectedBy: string[];
}

export class SignalValidator {
  constructor(
    private readonly minRR = 2,
    private readonly minConfidence = 0.6,
  ) {}

  validate(signal: SignalSchema): ValidationResult {
    const rejectedBy: string[] = [];

    if (signal.decision === DetectorDecision.NO_TRADE) {
      return { accepted: false, rr: 0, rejectedBy: ['Decision:NO_TRADE'] };
    }

    if (!signal.entry || !signal.stop || signal.targets.length === 0) {
      return { accepted: false, rr: 0, rejectedBy: ['SignalIncomplete'] };
    }

    const risk = Math.abs(signal.entry.price - signal.stop.price);
    const nearestTarget = signal.targets[0];
    const reward = Math.abs(nearestTarget.price - signal.entry.price);
    const rr = risk > 0 ? reward / risk : 0;

    if (rr < this.minRR) {
      rejectedBy.push(`RiskRewardBelowThreshold:${rr.toFixed(2)}`);
    }

    if (signal.confidence < this.minConfidence) {
      rejectedBy.push(
        `ConfidenceBelowThreshold:${signal.confidence.toFixed(2)}`,
      );
    }

    return {
      accepted: rejectedBy.length === 0,
      rr,
      rejectedBy,
    };
  }
}
