import { Logger } from '@nestjs/common';
import { Detector, Position, TradeSide } from '@barfinex/types';
import * as net from 'net';

type OpenPositionSnapshot = {
    symbol: string;
    side: TradeSide;
    entryPrice: number;
    quantity: number;
    entryTs: number;
};

type ClosedTradeMetric = {
    symbol: string;
    side: TradeSide;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    pnlAbs: number;
    pnlPct: number;
    rr: number;
    timeInTradeMs: number;
    closedAt: number;
    reason?: string;
};

export type DetectorPerformanceSnapshot = {
    detector: string;
    totalClosedTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgRr: number;
    avgTimeInTradeMs: number;
    consecutiveLosses: number;
    maxConsecutiveLosses: number;
    totalPnlAbs: number;
    rollingWinRate: number;
    rollingAvgRr: number;
    rollingExpectancy: number;
    rollingDrawdownPct: number;
    recommendedSizeMultiplier: number;
    recommendedConfidenceFloor: number;
    stopTradingMode: boolean;
    lastClosedAt?: number;
};

type QualityDecision = {
    allowed: boolean;
    reason?: string;
};

export class DetectorPerformanceMetrics {
    private readonly logger = new Logger(DetectorPerformanceMetrics.name);
    private readonly opened = new Map<string, OpenPositionSnapshot>();
    private readonly summary = {
        totalClosedTrades: 0,
        wins: 0,
        losses: 0,
        sumRr: 0,
        rrCount: 0,
        totalTimeInTradeMs: 0,
        consecutiveLosses: 0,
        maxConsecutiveLosses: 0,
        totalPnlAbs: 0,
        lastClosedAt: undefined as number | undefined,
    };
    private readonly recentClosed: ClosedTradeMetric[] = [];

    private readonly questdbEnabled =
        String(process.env.QUESTDB_AUDIT_ENABLED || 'false') === 'true';
    private readonly questdbHost = process.env.QUESTDB_HOST || '127.0.0.1';
    private readonly questdbIlpPort = Number(process.env.QUESTDB_ILP_PORT || 9009);

    evaluateQualityGate(detector: Detector): QualityDecision {
        const gate = detector.qualityGate ?? {};
        if (!gate.enabled) return { allowed: true };

        const minClosedTrades = gate.minClosedTrades ?? 30;
        if (this.summary.totalClosedTrades < minClosedTrades) {
            return { allowed: true };
        }

        const winRate = this.summary.wins / Math.max(1, this.summary.totalClosedTrades);
        const avgRr = this.summary.sumRr / Math.max(1, this.summary.rrCount);
        const minWinRate = gate.minWinRate ?? 0.4;
        const minAvgRr = gate.minAvgRr ?? 0.8;
        const maxConsecutiveLosses = gate.maxConsecutiveLosses ?? 5;
        const cooldownMs = gate.cooldownMs ?? 5 * 60 * 1000;

        if (this.summary.consecutiveLosses >= maxConsecutiveLosses) {
            const dt = Date.now() - (this.summary.lastClosedAt ?? 0);
            if (dt < cooldownMs) {
                return { allowed: false, reason: `quality-gate cooldown ${cooldownMs - dt}ms` };
            }
        }

        if (winRate < minWinRate && avgRr < minAvgRr) {
            return {
                allowed: false,
                reason: `quality-gate winRate=${winRate.toFixed(2)} avgRR=${avgRr.toFixed(2)}`,
            };
        }

        return { allowed: true };
    }

    onPositionOpened(position: Position): void {
        this.opened.set(position.symbol.name, {
            symbol: position.symbol.name,
            side: position.side,
            entryPrice: position.entryPrice,
            quantity: position.quantity,
            entryTs: position.entryTime ?? Date.now(),
        });
    }

    async onPositionClosed(options: {
        detector: Detector;
        position: Position;
        closePrice: number;
        closeQuantity: number;
        reason?: string;
    }): Promise<void> {
        const opened = this.opened.get(options.position.symbol.name) ?? {
            symbol: options.position.symbol.name,
            side: options.position.side,
            entryPrice: options.position.entryPrice,
            quantity: options.position.quantity,
            entryTs: options.position.entryTime ?? Date.now(),
        };

        const closedAt = Date.now();
        const quantity = Math.max(0, options.closeQuantity || opened.quantity);
        const pnlAbs = this.computePnlAbs(
            opened.entryPrice,
            options.closePrice,
            quantity,
            opened.side,
        );
        const pnlPct =
            opened.entryPrice > 0
                ? (pnlAbs / (opened.entryPrice * Math.max(quantity, 1e-9))) * 100
                : 0;
        const rr = this.computeRr(options.detector, opened.entryPrice, quantity, pnlAbs);
        const timeInTradeMs = Math.max(0, closedAt - opened.entryTs);

        const metric: ClosedTradeMetric = {
            symbol: opened.symbol,
            side: opened.side,
            entryPrice: opened.entryPrice,
            exitPrice: options.closePrice,
            quantity,
            pnlAbs,
            pnlPct,
            rr,
            timeInTradeMs,
            closedAt,
            reason: options.reason,
        };

        this.updateSummary(metric);
        if (options.position.quantity <= quantity + 1e-9) {
            this.opened.delete(options.position.symbol.name);
        }
        await this.persistMetric(options.detector, metric);
    }

    getSnapshot(detector: Detector): DetectorPerformanceSnapshot {
        const rolling = this.computeRollingStats();
        const recommendations = this.buildRecommendations(detector, rolling);
        return {
            detector: detector.sysname,
            totalClosedTrades: this.summary.totalClosedTrades,
            wins: this.summary.wins,
            losses: this.summary.losses,
            winRate:
                this.summary.wins / Math.max(1, this.summary.totalClosedTrades),
            avgRr: this.summary.sumRr / Math.max(1, this.summary.rrCount),
            avgTimeInTradeMs:
                this.summary.totalTimeInTradeMs /
                Math.max(1, this.summary.totalClosedTrades),
            consecutiveLosses: this.summary.consecutiveLosses,
            maxConsecutiveLosses: this.summary.maxConsecutiveLosses,
            totalPnlAbs: this.summary.totalPnlAbs,
            rollingWinRate: rolling.winRate,
            rollingAvgRr: rolling.avgRr,
            rollingExpectancy: rolling.expectancy,
            rollingDrawdownPct: rolling.drawdownPct,
            recommendedSizeMultiplier: recommendations.sizeMultiplier,
            recommendedConfidenceFloor: recommendations.confidenceFloor,
            stopTradingMode: recommendations.stopTradingMode,
            lastClosedAt: this.summary.lastClosedAt,
        };
    }

    private updateSummary(metric: ClosedTradeMetric): void {
        this.summary.totalClosedTrades += 1;
        this.summary.totalPnlAbs += metric.pnlAbs;
        this.summary.totalTimeInTradeMs += metric.timeInTradeMs;
        this.summary.sumRr += metric.rr;
        this.summary.rrCount += 1;
        this.summary.lastClosedAt = metric.closedAt;

        if (metric.pnlAbs > 0) {
            this.summary.wins += 1;
            this.summary.consecutiveLosses = 0;
        } else {
            this.summary.losses += 1;
            this.summary.consecutiveLosses += 1;
            this.summary.maxConsecutiveLosses = Math.max(
                this.summary.maxConsecutiveLosses,
                this.summary.consecutiveLosses,
            );
        }

        this.recentClosed.push(metric);
        const max = Number(process.env.DETECTOR_PERF_ROLLING_MAX || 200);
        if (this.recentClosed.length > max) {
            this.recentClosed.splice(0, this.recentClosed.length - max);
        }
    }

    private computeRollingStats(): {
        winRate: number;
        avgRr: number;
        expectancy: number;
        drawdownPct: number;
    } {
        const windowSize = Number(process.env.DETECTOR_PERF_ROLLING_WINDOW || 30);
        const rows = this.recentClosed.slice(Math.max(0, this.recentClosed.length - windowSize));
        if (rows.length === 0) {
            return { winRate: 0, avgRr: 0, expectancy: 0, drawdownPct: 0 };
        }

        let wins = 0;
        let rrSum = 0;
        let winRrSum = 0;
        let winCount = 0;
        let lossRrSum = 0;
        let lossCount = 0;

        let equity = 1;
        let peak = 1;
        let maxDrawdownPct = 0;

        for (const row of rows) {
            rrSum += row.rr;
            if (row.pnlAbs > 0) {
                wins += 1;
                winRrSum += row.rr;
                winCount += 1;
            } else {
                lossRrSum += Math.abs(row.rr);
                lossCount += 1;
            }

            equity *= 1 + row.pnlPct / 100;
            peak = Math.max(peak, equity);
            const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
            maxDrawdownPct = Math.max(maxDrawdownPct, dd);
        }

        const winRate = wins / rows.length;
        const avgRr = rrSum / rows.length;
        const avgWinRr = winCount > 0 ? winRrSum / winCount : 0;
        const avgLossRr = lossCount > 0 ? lossRrSum / lossCount : 0;
        const expectancy = winRate * avgWinRr - (1 - winRate) * avgLossRr;

        return {
            winRate,
            avgRr,
            expectancy,
            drawdownPct: maxDrawdownPct,
        };
    }

    private buildRecommendations(
        detector: Detector,
        rolling: { winRate: number; avgRr: number; expectancy: number; drawdownPct: number },
    ): {
        sizeMultiplier: number;
        confidenceFloor: number;
        stopTradingMode: boolean;
    } {
        const custom = (detector.customConfig ?? {}) as Record<string, unknown>;
        const hardDd = Number(custom.maxRollingDrawdownPct || 12);
        const softDd = Number(custom.softRollingDrawdownPct || 7);
        const minExpectancy = Number(custom.minRollingExpectancy || 0);
        const minWinRate = Number(custom.minRollingWinRate || 0.42);
        const minAvgRr = Number(custom.minRollingAvgRr || 0.75);

        const stopTradingMode =
            rolling.drawdownPct >= hardDd ||
            (rolling.expectancy < minExpectancy && rolling.winRate < minWinRate && rolling.avgRr < minAvgRr);
        if (stopTradingMode) {
            return { sizeMultiplier: 0, confidenceFloor: 0.78, stopTradingMode: true };
        }

        const degrade =
            rolling.drawdownPct >= softDd ||
            rolling.expectancy < 0 ||
            rolling.winRate < minWinRate ||
            rolling.avgRr < minAvgRr;
        if (degrade) {
            return { sizeMultiplier: 0.5, confidenceFloor: 0.66, stopTradingMode: false };
        }

        return { sizeMultiplier: 1, confidenceFloor: 0.58, stopTradingMode: false };
    }

    private computePnlAbs(
        entryPrice: number,
        exitPrice: number,
        quantity: number,
        side: TradeSide,
    ): number {
        if (side === TradeSide.LONG) return (exitPrice - entryPrice) * quantity;
        return (entryPrice - exitPrice) * quantity;
    }

    private computeRr(
        detector: Detector,
        entryPrice: number,
        quantity: number,
        pnlAbs: number,
    ): number {
        const custom = (detector.customConfig ?? {}) as Record<string, unknown>;
        const stopLossPercentRaw =
            Number(custom.stopLossPercent) ||
            Number(custom.stopLoss) ||
            0.5;
        const stopLossPercent = Math.max(0.05, stopLossPercentRaw);
        const riskAbs = entryPrice * quantity * (stopLossPercent / 100);
        if (riskAbs <= 0) return 0;
        return pnlAbs / riskAbs;
    }

    private async persistMetric(detector: Detector, metric: ClosedTradeMetric): Promise<void> {
        if (!this.questdbEnabled) return;
        const perfCfg = detector.performance ?? {};
        if (perfCfg.enabled === false) return;

        const tradeTable = perfCfg.questTableTrades || 'detector_trade_metrics';
        const summaryTable = perfCfg.questTableSummary || 'detector_performance_summary';

        await this.writeIlpLine(
            this.buildIlpLine(
                tradeTable,
                {
                    detector: detector.sysname,
                    symbol: metric.symbol,
                    side: metric.side,
                },
                {
                    entry_price: metric.entryPrice,
                    exit_price: metric.exitPrice,
                    quantity: metric.quantity,
                    pnl_abs: metric.pnlAbs,
                    pnl_pct: metric.pnlPct,
                    rr: metric.rr,
                    time_in_trade_ms: Math.trunc(metric.timeInTradeMs),
                    reason: metric.reason ?? '',
                },
                BigInt(metric.closedAt) * 1_000_000n,
            ),
        );

        const snapshot = this.getSnapshot(detector);
        await this.writeIlpLine(
            this.buildIlpLine(
                summaryTable,
                {
                    detector: detector.sysname,
                },
                {
                    total_closed: snapshot.totalClosedTrades,
                    wins: snapshot.wins,
                    losses: snapshot.losses,
                    win_rate: snapshot.winRate,
                    avg_rr: snapshot.avgRr,
                    avg_time_ms: Math.trunc(snapshot.avgTimeInTradeMs),
                    consecutive_losses: snapshot.consecutiveLosses,
                    max_consecutive_losses: snapshot.maxConsecutiveLosses,
                    total_pnl_abs: snapshot.totalPnlAbs,
                },
                BigInt(Date.now()) * 1_000_000n,
            ),
        );
    }

    private buildIlpLine(
        table: string,
        tags: Record<string, string | number | boolean>,
        fields: Record<string, string | number | boolean>,
        tsNs: bigint,
    ): string {
        const measurement = this.escapeName(table);
        const tagPart = Object.entries(tags)
            .map(([k, v]) => `${this.escapeName(k)}=${this.escapeTagValue(v)}`)
            .join(',');
        const fieldPart = Object.entries(fields)
            .map(([k, v]) => `${this.escapeName(k)}=${this.toField(v)}`)
            .join(',');
        return `${measurement}${tagPart ? ',' + tagPart : ''} ${fieldPart} ${tsNs.toString()}\n`;
    }

    private toField(value: string | number | boolean): string {
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return Number.isInteger(value) ? `${value}i` : String(value);
        return `"${String(value).replace(/"/g, '\\"')}"`;
    }

    private escapeName(value: string): string {
        return value.replace(/[ ,=]/g, '\\$&');
    }

    private escapeTagValue(value: string | number | boolean): string {
        return String(value).replace(/[ ,=]/g, '\\$&');
    }

    private async writeIlpLine(line: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const socket = new net.Socket();
            socket.once('error', (error) => {
                socket.destroy();
                reject(error);
            });
            socket.connect(this.questdbIlpPort, this.questdbHost, () => {
                socket.write(line, (error?: Error | null) => {
                    if (error) {
                        socket.destroy();
                        reject(error);
                        return;
                    }
                    socket.end();
                    resolve();
                });
            });
        }).catch((error: unknown) => {
            this.logger.warn(
                `[writeIlpLine] questdb write failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        });
    }
}

