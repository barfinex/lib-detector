import { ForbiddenException } from '@nestjs/common';
import {
  ConnectorType,
  MarketType,
  Trade,
  OrderBook,
  AccountEvent,
  Order,
  InspectorRegulation,
  PluginHook,
  Provider,
  DetectorEventType,
  Symbol as BfxSymbol,
  TimeFrame,
  Account,
  Connector,
  Candle,
  SymbolPrice,
  CandleActionStatus,
  TradeSide,
  Position,
} from '@barfinex/types';
import { DetectorService } from '@barfinex/detector';

/** Внутреннее представление карты индикаторов */
type IndicatorMap = Record<
  string, // symbol name
  Partial<Record<TimeFrame, Record<string, unknown>>>
>;

export function onSymbolPricesUpdateHandler(
  this: DetectorService,
  _value: SymbolPrice,
  _connectorType: ConnectorType,
  _marketType: MarketType,
): void {
  // if (!this.isReady) return;
}

export function onSymbolsUpdateHandler(
  this: DetectorService,
  _value: BfxSymbol[],
  _connectorType: ConnectorType,
  _marketType: MarketType,
): void {
  // if (!this.isReady) return;
}

export function onCandleUpdateHandler(
  this: DetectorService,
  _value: Candle,
  _connectorType: ConnectorType,
  _marketType: MarketType,
): void {
  // if (!this.isReady) return;
}

export async function onModuleInit(this: DetectorService): Promise<void> {
  this.logger.log(`ModuleInit`);
  this.keyService.initializeKey();
  this.options.key = this.keyService.key;

  console.log("Modul Init this.options.providers.length", this.options.providers.length)

  if (this.pluginsForRegister?.length) {
    this.pluginDriverService.register(this.pluginsForRegister);
    this.plugins = [];
  }

  this.openOrderMoment = Date.now();
  this.closeOrderMoment = Date.now();

  if (!this.options.sysname || this.options.sysname.length === 0) {
    this.options.sysname = this.constructor.name;
  }

  // ⚡ Не затираем — если есть, берём из TestConfigService
  if (!this.options.providers) {
    this.options.providers = [];
  }
  if (!this.options.symbols) {
    this.options.symbols = [];
  }
  if (!this.options.intervals) {
    this.options.intervals = [];
  }

  // Инициализация структуры свечей
  this.candles = this.candles || {};
  for (const symbol of this.options.symbols as BfxSymbol[]) {
    if (!this.candles[symbol.name]) this.candles[symbol.name] = {};
    for (const interval of this.options.intervals as TimeFrame[]) {
      if (!this.candles[symbol.name][interval]) {
        this.candles[symbol.name][interval] = [];
      }
    }
  }

  // Автодополнение провайдеров (обогащаем, если есть restApiUrl)
  for (let i = 0; i < this.options.providers.length; i++) {
    const provider: Provider = this.options.providers[i];

    if (!provider.restApiUrl || !provider.restApiUrl.startsWith('http')) {
      this.logger.warn(
        `[onModuleInit] Skip provider with invalid restApiUrl=${provider.restApiUrl}`,
      );
      continue;
    }

    if (!provider.connectors || provider.connectors.length === 0) {
      try {
        const updatedProvider = await this.connectorService.getProviderOptions({
          providerRestApiUrl: provider.restApiUrl,
        });
        if (updatedProvider) {
          this.options.providers[i] = { ...provider, ...updatedProvider };
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `[getProviderOptions] ${provider.restApiUrl} → ${msg}`,
        );
      }
    }
  }

  // Жёстко фиксируем providers, чтобы registerEvent их не терял
  (this as any)._providers = this.options.providers;

  // Регистрация детектора у каждого провайдера
  for (const provider of this.options.providers) {
    if (!provider.restApiUrl || !provider.restApiUrl.startsWith('http')) {
      continue;
    }
    try {
      await this.connectorService.registerDetector({
        providerRestApiUrl: provider.restApiUrl,
        detector: { ...this.options, isActive: true },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`[registerDetector] ${provider.restApiUrl} → ${msg}`);
    }
  }

  if (this.options.isBlocked) {
    this.options.isActive = false;
  }

  if (this.options.isActive) {
    const accounts: Account[] = [];

    for (const provider of this.options.providers) {
      if (!provider.restApiUrl || !provider.restApiUrl.startsWith('http')) {
        continue;
      }

      const connectors: Connector[] = provider.connectors ?? [];
      for (const connector of connectors) {
        const markets = connector.markets ?? [];
        for (const market of markets) {
          try {
            const marketAccount = await this.connectorService.getAccount({
              providerRestApiUrl: provider.restApiUrl,
              connectorType: connector.connectorType,
              marketType: market.marketType,
            });
            accounts.push(marketAccount);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.warn(
              `[getAccount] ${connector.connectorType}/${market.marketType} → ${msg}`,
            );
          }
        }
      }
    }

    this.accounts.push(...accounts);
    this.options.orders = accounts.flatMap((acc) => acc.orders ?? []);

    if (this.accounts.length) {
      await this.pluginDriverService.asyncReduce(PluginHook.onStart, null);

      if (this.options.preloadHistory) {
        await this.getHistoryCandles();
        this.ensureHistoryReady();
        this.logger.log(
          `[History] preload enabled → ready for symbols=${JSON.stringify(
            (this.options.symbols as BfxSymbol[]).map((s) => s.name),
          )} intervals=${JSON.stringify(
            this.options.intervals as TimeFrame[],
          )}`,
        );
      }

      this.lastTrades = {};

      this.accounts.forEach((account: Account) => {
        this.logger.log(
          `[InitAccounts] ${account.connectorType}/${account.marketType} → ${account.orders?.length || 0} ордеров, ${account.positions?.length || 0} позиций`,
        );
      });
    }
  }

  console.log("Modul Init this.options.providers.length", this.options.providers.length)



  this.registerEvent(DetectorEventType.DETECTOR_STARTED, { symbols: [] });

  this.logger.log(`Detector is ready`);
  this.onInit();
}




export async function onModuleDestroy(this: DetectorService): Promise<void> {
  this.logger.log(`Destroy`);

  for (const provider of this.options.providers) {
    try {
      await this.connectorService.updateDetector({
        providerRestApiUrl: provider.restApiUrl,
        detector: { ...this.options, isActive: true },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `[updateDetector/onModuleDestroy] ${provider.restApiUrl} → ${msg}`,
      );
    }
  }

  await this.pluginDriverService.asyncReduce(PluginHook.onDispose, null);
  this.registerEvent(DetectorEventType.DETECTOR_STOPPED, { symbols: [] });
}

export async function onApplicationShutdown(
  this: DetectorService,
): Promise<void> {
  this.logger.log(`ApplicationShutdown`);

  for (const provider of this.options.providers) {
    try {
      await this.connectorService.updateDetector({
        providerRestApiUrl: provider.restApiUrl,
        detector: { ...this.options, isActive: true },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `[updateDetector/onApplicationShutdown] ${provider.restApiUrl} → ${msg}`,
      );
    }
  }

  await this.pluginDriverService.asyncReduce(PluginHook.onDispose, null);
}

export async function onTradeHandler(
  this: DetectorService,
  trade: Trade,
  connectorType: ConnectorType,
  marketType: MarketType,
): Promise<void> {
  // if (!this.ensureHistoryReady()) return;

  if (this.accounts && this.options.isActive) {
    // ⚡ выполняем плагины параллельно
    await Promise.all([
      this.pluginDriverService.asyncReduce(PluginHook.onTrade, null, trade),
      (async () => {
        const updateCandleByTrade = await this.updateCandleByTrade({ trade });
        updateCandleByTrade.forEach(({ status, candle }) => {
          if (status === CandleActionStatus.update || status === 'update') {
            this.onCandleUpdate(candle, trade, connectorType, marketType);
          } else if (status === CandleActionStatus.create || status === 'create') {
            this.onCandleClose(candle, connectorType, marketType);
            this.onCandleOpen(candle, connectorType, marketType);
          }
        });
      })(),
    ]);

    this.onTrade(trade, connectorType, marketType);
    this.lastTrades[trade.symbol.name] = trade;

    await this.pluginDriverService.asyncReduce(PluginHook.onAfterTrade, null, trade);
  }

  this.registerEvent(DetectorEventType.TICK_RECEIVED, {
    symbols: [{ name: trade.symbol.name }],
    price: trade.price,
    quantity: trade.volume,
  });
}


export async function onOrderBookUpdateHandler(
  this: DetectorService,
  orderbook: OrderBook,
  connectorType: ConnectorType,
  marketType: MarketType,
): Promise<void> {
  // if (!this.isReady) {
  //   this.logger.warn(`[onOrderBookUpdateHandler] Detector not ready, skip`);
  //   return;
  // }

  // if (!this.ensureHistoryReady()) return;

  if (this.accounts && this.options.isActive) {
    await this.pluginDriverService.asyncReduce(
      PluginHook.onOrderBookUpdate,
      null,
      orderbook,
    );

    // const account = this.accounts.find(
    //   (a) => a.connectorType === connectorType && a.marketType === marketType,
    // );

    this.onOrderBookUpdate(orderbook, connectorType, marketType);
    await this.pluginDriverService.asyncReduce(
      PluginHook.onAfterOrderBookUpdate,
      null,
      orderbook,
    );
  }
}

export async function onAccountUpdateHandler(
  this: DetectorService,
  accountEvent: AccountEvent,
): Promise<void> {
  // if (!this.isReady) {
  //   this.logger.warn(`[onAccountUpdateHandler] Detector not ready, skip`);
  //   return;
  // }

  // if (!this.ensureHistoryReady()) return;

  for (const provider of this.options.providers) {
    const connectors: Connector[] = provider.connectors ?? [];
    const activeConnector = connectors.find((c) => c.isActive);
    if (!activeConnector) continue;

    const targetAccount = this.accounts.find(
      (a) =>
        a.connectorType === activeConnector.connectorType &&
        a.marketType === accountEvent.options.marketType,
    );
    if (!targetAccount) continue;

    if (
      accountEvent.eventType === 'ORDER_TRADE_UPDATE' &&
      targetAccount.orders?.find((o: Order) => o.externalId === accountEvent.options.orderId)
    ) {
      switch (accountEvent.options.orderStatus) {
        case 'CANCELED':
        case 'EXPIRED':
          targetAccount.orders = (targetAccount.orders as Order[]).filter(
            (o: Order) => o.externalId !== accountEvent.options.orderId,
          );
          this.updateAccount(targetAccount);
          break;
      }
    } else {
      try {
        const updatedAccount = await this.connectorService.getAccount({
          providerRestApiUrl: provider.restApiUrl,
          connectorType: activeConnector.connectorType,
          marketType: accountEvent.options.marketType,
        });
        if (updatedAccount && activeConnector.isActive) {
          const pluginContext = this.createPluginContext(updatedAccount);
          await this.pluginDriverService.asyncReduce(
            PluginHook.onAccountUpdate,
            pluginContext,
          );
          this.onAccountUpdate(updatedAccount);
          await this.pluginDriverService.asyncReduce(
            PluginHook.onAfterAccountUpdate,
            pluginContext,
          );
          this.updateAccount(updatedAccount);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`[onAccountUpdate] getAccount failed → ${msg}`);
      }
    }
  }
}

export async function onOrderCreateHandler(
  this: DetectorService,
  order: Order,
): Promise<void> {
  // if (!this.isReady) {
  //   this.logger.warn(`[onOrderCreateHandler] Detector not ready, skip`);
  //   return;
  // }

  // if (!this.ensureHistoryReady()) return;

  await this.pluginDriverService.asyncReduce(PluginHook.onOrderOpen, null, order);
  this.registerEvent(DetectorEventType.ORDER_PLACED, {
    symbols: order.symbol ? [{ name: order.symbol.name }] : [],
    order,
  });
}

export async function onOrderCloseHandler(
  this: DetectorService,
  order: Order,
): Promise<void> {
  // if (!this.isReady) {
  //   this.logger.warn(`[onOrderCloseHandler] Detector not ready, skip`);
  //   return;
  // }

  // if (!this.ensureHistoryReady()) return;

  await this.pluginDriverService.asyncReduce(PluginHook.onOrderClose, null, order);
  await this.pluginDriverService.asyncReduce(PluginHook.onAfterOrderClose, null, order);

  this.registerEvent(DetectorEventType.ORDER_FILLED, {
    symbols: order.symbol ? [{ name: order.symbol.name }] : [],
    order,
  });
}

export async function onInspectorRegulationHandler(
  this: DetectorService,
  regulation: InspectorRegulation,
): Promise<void> {
  // if (!this.isReady) {
  //   this.logger.warn(`[onInspectorRegulationHandler] Detector not ready, skip`);
  //   return;
  // }

  // if (!this.ensureHistoryReady()) return;

  await this.pluginDriverService.asyncReduce(
    PluginHook.onInspectorRegulation,
    null,
    regulation,
  );

  if (this.options.sysname === regulation.detectorSysname) {
    this.options.isBlocked = true;
    this.options.isActive = false;
    throw new ForbiddenException(
      `Detector ${regulation.detectorSysname} is block!`,
    );
  }

  await this.pluginDriverService.asyncReduce(
    PluginHook.onAfterInspectorRegulation,
    null,
    regulation,
  );
}

export function emitPluginDataChanged(
  this: DetectorService,
  pluginName: string,
  change: Record<string, unknown>,
  meta?: Record<string, unknown>,
): void {
  // if (!this.isReady) return;

  this.registerEvent(DetectorEventType.CONFIG_UPDATED, {
    symbols: [],
    scope: 'plugin',
    pluginName,
    change,
    ...(meta ?? {}),
    ts: Date.now(),
  });
}

export function upsertIndicator(
  this: DetectorService,
  args: {
    symbol: BfxSymbol;
    interval: TimeFrame;
    key: string;
    value: unknown;
    meta?: Record<string, unknown>;
  },
): void {
  // if (!this.isReady) return;

  const { symbol, interval, key, value, meta } = args;
  const map = (this as any).indicators ?? {};
  if (!map[symbol.name]) map[symbol.name] = {};
  if (!map[symbol.name]![interval]) map[symbol.name]![interval] = {};

  const slot = map[symbol.name]![interval]!;
  const prev = Object.prototype.hasOwnProperty.call(slot, key) ? slot[key] : undefined;

  const changed =
    prev === undefined
      ? true
      : (typeof prev === 'object' || typeof value === 'object')
        ? JSON.stringify(prev) !== JSON.stringify(value)
        : prev !== value;

  if (!changed) return;

  slot[key] = value;
  (this as any).indicators = map;

  this.registerEvent(DetectorEventType.CONFIG_UPDATED, {
    symbols: [{ name: symbol.name }],
    scope: 'indicator',
    interval,
    key,
    prev,
    next: value,
    ...(meta ?? {}),
    ts: Date.now(),
  });
}
