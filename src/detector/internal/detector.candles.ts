import moment from 'moment'; import type { Candle, Symbol, TimeFrame, CandleActionStatus, Trade } from '@barfinex/types';

export async function getHistoryCandles(this: any) {

  this.candles = {};
  for (let s = 0; s < this.options.symbols.length; s++) {
    const symbol: Symbol = this.options.symbols[s]; this.candles[symbol.name] = {};
    if (this.options.intervals) for (let i = 0; i < this.options.intervals.length; i++) {
      const interval: TimeFrame = this.options.intervals[i]; const candles: Candle[] = [];
      for (const provider of this.options.providers) for (const connector of provider.connectors)
        for (const market of connector.markets) for (const symbol of market.symbols) {
          const candleData = await this.connectorService.getCandles({ providerRestApiUrl: provider.restApiUrl, connectorType: connector.connectorType, marketType: market.marketType, symbol, interval });
          candles.push(...candleData);
        }
      this.candles[symbol.name][interval] = candles;
    }
  }

}

export function ensureHistoryReady(this: any): boolean {
  // сохраняем состояние между вызовами
  if (this.__historyReadyState === undefined) this.__historyReadyState = null as null | boolean;

  let ready = true;
  let reason = '';

  if (!this.candles) {
    ready = false;
    reason = 'candles not initialized';
  } else {
    outer: for (const symbol of this.options.symbols as Symbol[]) {
      if (!this.candles[symbol.name]) {
        ready = false;
        reason = `no candles for ${symbol.name}`;
        break;
      }
      for (const interval of this.options.intervals as TimeFrame[]) {
        const arr = this.candles[symbol.name][interval] as Candle[] | undefined;
        if (!arr || !arr.length) {
          ready = false;
          reason = `no candles for ${symbol.name} @ ${interval}`;
          break outer;
        }
      }
    }
  }

  // логируем только при смене состояния
  if (!ready) {
    if (this.__historyReadyState !== false) {
      this.logger.warn(`[History] not ready: ${reason}`);
      this.__historyReadyState = false;
    }
    return false;
  }

  if (this.__historyReadyState !== true) {
    const symbols = (this.options.symbols || []).map((s: { name: any; }) => s.name).join(',');
    const intervals = (this.options.intervals || []).join(',');
    this.logger.log(`[History] ready for symbols=[${symbols}] intervals=[${intervals}]`);
    this.__historyReadyState = true;
  }

  return true;
}


export function getSymbolCandlesState(this: any, symbol: Symbol, interval: TimeFrame, orderBy?: string) {

  if (!this.candles || !this.candles[symbol.name] || !this.candles[symbol.name][interval]) return [];
  return orderBy === 'desc' ? [...this.candles[symbol.name][interval]].reverse() : this.candles[symbol.name][interval];

}

export function getSymbolIndocatorState(this: any, symbol: Symbol, indicators: { groups: string[]; items: string[] }, interval: TimeFrame) {

  const result: { [key: string]: any } = {}; if (!this.indicators || !this.indicators[symbol.name] || !this.indicators[symbol.name][interval]) return {};
  indicators.items.forEach((item) => { if (this.indicators[symbol.name][interval][item]) result[item] = this.indicators[symbol.name][interval][item]; });
  indicators.groups.forEach((group) => {
    Object.keys(this.indicators[symbol.name][interval]).forEach((item) => {
      if (this.indicators[symbol.name][interval][item].options.group == group) result[item] = this.indicators[symbol.name][interval][item];
    });
  });

  return result;
}

export async function closeCandle(this: any, options: { candle?: Candle }): Promise<void> {

  const { candle } = options; if (!candle) return;
  this.options.symbols.forEach((detectorSymbol: Symbol) => {
    const { name: symbolName } = detectorSymbol; (this.options.intervals as TimeFrame[]).forEach((interval) => {
      if (candle.symbol.name == symbolName && candle.interval == interval) {
        if (moment.utc(this.candles[symbolName][interval][0].time).toISOString() == moment.utc(candle.time).toISOString()) {
          this.candles[symbolName][interval][0] = { ...candle };
        }
      }
    });
  });

}

export async function updateCandleByTrade(this: any, options: { trade?: Trade }): Promise<{ status: CandleActionStatus; candle: Candle }[]> {

  let result: { status: CandleActionStatus; candle: Candle }[] = []; const { trade } = options;
  if (trade) { this.options.symbols.forEach((_detectorSymbol: Symbol) => { (this.options.intervals as TimeFrame[]).forEach((_interval) => { /* intentionally empty */ }); }); }

  return result;

}
export function getCandleValueStatus(this: any, options: { currentTime: number; lastCandleTime: number; interval: TimeFrame }): { isNewCandle: boolean; candleMoment: number } {

  const { currentTime, lastCandleTime, interval } = options; let result = { isNewCandle: false, candleMoment: 0 };
  const u = (n: number, unit: moment.unitOfTime.DurationConstructor) => moment.utc(currentTime).add(-n, unit).toISOString() >= moment.utc(lastCandleTime).toISOString();
  switch (interval) {
    case 'min1': if (u(1, 'minutes')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(1, 'minutes').format('x')); } break;
    case 'min3': if (u(3, 'minutes')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(3, 'minutes').format('x')); } break;
    case 'min5': if (u(5, 'minutes')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(5, 'minutes').format('x')); } break;
    case 'min15': if (u(15, 'minutes')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(15, 'minutes').format('x')); } break;
    case 'min30': if (u(30, 'minutes')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(30, 'minutes').format('x')); } break;
    case 'h1': if (u(1, 'hours')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(1, 'hours').format('x')); } break;
    case 'h2': if (u(2, 'hours')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(2, 'hours').format('x')); } break;
    case 'h4': if (u(4, 'hours')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(4, 'hours').format('x')); } break;
    case 'day': if (u(1, 'days')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(1, 'days').format('x')); } break;
    case 'month': if (u(1, 'months')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(1, 'months').format('x')); } break;
    case 'week': if (u(7, 'days')) { result.isNewCandle = true; result.candleMoment = Number(moment.utc(lastCandleTime).add(7, 'days').format('x')); } break;
  } return result;

}