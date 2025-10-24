import moment from 'moment';
import type { Detector } from '@barfinex/types';
import { DetectorService } from '../detector.service';

export function updateOptions(
    this: DetectorService,
    newOptions: Partial<Detector>,
): void {
    const prev = this.options;

    // Обновляем только то, что реально есть в Detector
    this.options = {
        ...prev,
        ...newOptions,

        // защищаем критичные поля от затирания
        providers: newOptions.providers ?? prev.providers,
        symbols: newOptions.symbols ?? prev.symbols,
        intervals: newOptions.intervals ?? prev.intervals,
        orders: newOptions.orders ?? prev.orders,
        indicators: newOptions.indicators ?? prev.indicators,
    };

    this.logger.debug(
        `[updateOptions] providers: ${prev.providers?.length ?? 0} -> ${this.options.providers?.length ?? 0}, ` +
        `orders: ${prev.orders?.length ?? 0} -> ${this.options.orders?.length ?? 0}, ` +
        `symbols: ${prev.symbols?.length ?? 0} -> ${this.options.symbols?.length ?? 0}, ` +
        `intervals: ${prev.intervals?.length ?? 0} -> ${this.options.intervals?.length ?? 0}`,
    );
}

export function getSymbolsLastTrades(this: any) {
    return this.lastTrades;
}

export function getName(this: any) {
    return this.constructor.name;
}

export function getStringTime(this: any, time: number): string {
    return moment.utc(time).format('YYYY-MM-DD HH:mm:ss');
}

export async function sendMessage(
    this: any,
    _text: string,
    _object: any,
): Promise<any> { }
