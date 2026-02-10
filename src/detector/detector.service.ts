import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConnectorService } from '@barfinex/connectors';
import { OrderService } from '@barfinex/orders';
import { KeyService } from '@barfinex/key';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { PluginDriverService } from '@barfinex/plugin-driver';

import { buildDetectorConfig, ConnectorType, DetectorConfigInput, MarketType, OrderBook, PluginInterface, Provider, SymbolPrice } from '@barfinex/types';

import {
  Detector,
  Account,
  Candle,
  Trade,
  Order,
  Symbol,
  TradeSide,
  InspectorRegulation,
  SubscriptionValue,
  DetectorEventType,
  Position,
} from '@barfinex/types';
import { SubscriptionType } from '@barfinex/types';

import {
  getDefaultOptions,
  getOptionsPrev,
  setOptionsPrev,
} from './internal/detector.options';
import * as Accounts from './internal/detector.accounts';
import * as Candles from './internal/detector.candles';
import * as Orders from './internal/detector.orders';
import * as Handlers from './internal/detector.handlers';
import * as Plugins from './internal/detector.plugins';
import * as Utils from './internal/detector.utils';

// 🔹 маппер для свечей
// import { candleMapper } from '@barfinex/utils';
import { DetectorPositionManager } from './internal/detector.position-manager';

@Injectable()
export abstract class DetectorService {
  protected readonly logger = new Logger(DetectorService.name);

  public id!: string;
  public dispose!: () => Promise<void>;

  /** Флаг готовности */
  public isReady = false;

  /** Менеджер позиций */
  protected readonly positions = new DetectorPositionManager();

  protected _options: Detector;
  protected optionsPrev?: Detector;

  protected _accounts: Account[] = [];
  public orders: Array<Order> = [];

  protected pluginsForRegister: any[] = [];
  protected plugins: any[] = [];
  protected lastTrades: { [index: string]: Trade } = {};
  protected candles: { [symbol: string]: { [interval: string]: Candle[] } } =
    {};
  protected indicators: any = {};

  protected openOrderMoment = Date.now();
  protected closeOrderMoment = Date.now();

  protected readonly isEmitToRedisEnabled = true;

  protected get providers(): Provider[] {
    return this._options.providers ?? [];
  }

  constructor(
    @Inject(forwardRef(() => PluginDriverService))
    protected readonly pluginDriverService: PluginDriverService,
    protected readonly connectorService: ConnectorService,
    protected readonly keyService: KeyService,
    protected readonly orderService: OrderService,
    protected readonly configService: ConfigService,
    @Inject('PROVIDER_SERVICE') protected readonly client: ClientProxy,

    @Optional()
    @Inject('DETECTOR_CONFIG_SERVICE')
    private readonly configServiceFromDI?: { detector: DetectorConfigInput },

    @Optional()
    @Inject('DETECTOR_OPTIONS')
    private readonly optionsFromDI?: Partial<Detector>,
  ) {


    const cfg: Partial<Detector> =
      this.optionsFromDI ?? this.configServiceFromDI?.detector ?? {};

    this._options = {
      ...getDefaultOptions(),
      ...buildDetectorConfig(cfg),
    } as Detector;






    this.logger.debug(
      `[constructor] Final providers count=${this.providers.length}`,
    );
    if (this.providers.length > 0) {
      this.logger.debug(
        `[constructor] Final providers → ${this.providers
          .map((p) => `${p.key}@${p.restApiUrl}`)
          .join(', ')}`,
      );
    }
  }

  // ===================== Getters/Setters =====================

  public get options(): Detector {
    return this._options;
  }
  public set options(value: Detector) {
    this.logger.debug(`⚠️ options reassigned`);
    this._options = value;
  }

  getOptionsPrev(): Detector | undefined {
    return getOptionsPrev.bind(this)();
  }
  setOptionsPrev(options: Detector): void {
    setOptionsPrev.bind(this)(options);
  }

  get accounts(): Account[] {
    return this._accounts;
  }
  set accounts(value: Account[]) {
    this._accounts = value;
  }

  // ===================== Position API =====================

  async openPosition(params: {
    symbol: Symbol;
    side: TradeSide;
    quantity: number;
    price?: number;
    connectorType: ConnectorType;
    marketType: MarketType;
    providerRestApiUrl?: string;
    useSandbox?: boolean;
  }): Promise<{ position: Position; account: Account }> {
    const account = this.accounts.find(
      (a) => a.connectorType === params.connectorType && a.marketType === params.marketType,
    );
    if (!account) {
      throw new Error(
        `[openPosition] Account not found for ${params.connectorType}/${params.marketType}`,
      );
    }

    const result = await this.orderService.openPosition({
      ...params,
      account, // ⚡ прокидываем найденный аккаунт
      providerRestApiUrl: params.providerRestApiUrl ?? this.options.restApiUrl!,
      useSandbox: params.useSandbox ?? this.options.useSandbox ?? false,
    });

    this.positions.add(result.position);

    return { position: result.position, account };
  }

  async closePosition(params: {
    position: Position;
    connectorType: ConnectorType;
    marketType: MarketType;
    quantity?: number;
    providerRestApiUrl?: string;
    useSandbox?: boolean;
  }): Promise<{ order: Order; account: Account }> {
    const account = this.accounts.find(
      (a) => a.connectorType === params.connectorType && a.marketType === params.marketType,
    );
    if (!account) {
      throw new Error(
        `[closePosition] Account not found for ${params.connectorType}/${params.marketType}`,
      );
    }

    const result = await this.orderService.closePosition({
      ...params,
      account, // ⚡ прокидываем найденный аккаунт
      providerRestApiUrl: params.providerRestApiUrl ?? this.options.restApiUrl!,
      useSandbox: params.useSandbox ?? this.options.useSandbox ?? false,
    });

    if (params.quantity === undefined || params.quantity >= params.position.quantity) {
      this.positions.remove(params.position);
    } else {
      const updated = {
        ...params.position,
        quantity: params.position.quantity - (params.quantity ?? 0),
      } as Position;
      this.positions.update(updated);
    }

    return { order: result.order, account };
  }

  updateTrailingStop(
    lastPrice: number,
    position: Position,
    trailingStopDistance: number,
  ): number | undefined {
    const newStop = this.orderService.updateTrailingStop(
      lastPrice,
      position,
      trailingStopDistance,
    );
    if (newStop !== undefined) {
      const updated = { ...position, trailingStop: newStop };
      this.positions.update(updated);
    }
    return newStop;
  }


  // ===================== Lifecycle =====================

  async initDetectorLifecycle() {
    this.logger.debug(`[onModuleInit] DetectorService init start...`);

    console.log("this.options:", this.options);
    console.log("this.providers:", this.providers.length);


    console.log("!!! this.options.plugins:", this.options.plugins);


    // 1. Плагины из конфигурации (config.plugins.modules)




    const configModules = this.options.plugins?.modules ?? [];

    console.log("configModules:", configModules);

    if (configModules.length > 0) {
      const instances = configModules.map((Cls: any) => this.pluginDriverService.createAndRegister(Cls));
      this.registerPlugins(instances);
    }

    // 2. Плагины из PluginDriverService
    const driverPlugins = (this.pluginDriverService as any)?.getAllPlugins?.() as PluginInterface[] | undefined;
    if (driverPlugins!.length > 0) {
      this.registerPlugins(driverPlugins!);
      this.logger.log(
        `[onModuleInit] Auto-registered ${driverPlugins!.length} plugin(s) from PluginDriverService`,
      );
    } else {
      this.logger.debug(`[onModuleInit] No plugins found in PluginDriverService`);
    }

    // 3. Дальше обычный init
    await this.initializeDetector();
  }


  async initializeDetector(): Promise<void> {
    if (this.options.providers?.length > 0) {
      this.logger.log(
        `[initializeDetector] Using ${this.providers.length} provider(s) → ${this.providers.map(p => p.key).join(', ')}`,
      );
    } else if (this.options.restApiUrl) {
      this.logger.warn(`[initializeDetector] No providers in config, fetching from ConnectorService...`);
      try {
        const providerOptions = await this.connectorService.getProviderOptions({
          providerRestApiUrl: this.options.restApiUrl,
        });

        if (providerOptions) {
          (this.options as any).providers = [providerOptions];
          this.logger.log(
            `[initializeDetector] Loaded provider from ${this.options.restApiUrl} → ${providerOptions.key}`,
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `[initializeDetector] Failed to fetch providers from ${this.options.restApiUrl} → ${msg}`,
        );
      }
    } else {
      this.logger.warn(`[initializeDetector] No providers and restApiUrl not set → detector may not work`);
    }

    this.isReady = true;
    this.logger.log(
      `DetectorService initialized → providers=${this.providers?.length ?? 0}, symbols=${this.options.symbols?.length ?? 0}`,
    );

    this.onStart()
  }


  async onModuleDestroy() {
    return Handlers.onModuleDestroy.bind(this)();
  }

  async onApplicationShutdown() {
    return Handlers.onApplicationShutdown.bind(this)();
  }

  // ===================== Core Methods =====================

  public registerEvent(
    eventType: DetectorEventType,
    payload: Record<string, unknown> = {},
  ): void {
    if (!this.isEmitToRedisEnabled) return;

    if (!this.isReady && eventType !== DetectorEventType.DETECTOR_STARTED) {
      this.logger.warn(
        `[registerEvent] skip ${eventType} → detector not ready yet`,
      );
      return;
    }

    const symbols = (payload.symbols as Symbol[] | undefined) ?? [];

    // console.log("this.providers", this.providers?.map(p => `${p.key}@${p.restApiUrl}`));
    // console.log("this", this);


    // this.logger.debug(
    //   `[registerEvent] event=${eventType} → using providers=${this.providers?.length ?? 0}`,
    // );

    for (const provider of this.providers ?? []) {
      for (const connector of provider.connectors ?? []) {
        if (!connector.isActive) continue;

        for (const market of connector.markets ?? []) {
          const subscriptionValue: SubscriptionValue = {
            value: { eventType, payload, symbols },
            options: {
              connectorType: connector.connectorType,
              marketType: market.marketType,
              key: this.options.key,
              updateMoment: Date.now(),
            },
          };
          this.client.emit(SubscriptionType.DETECTOR_EVENT, subscriptionValue);
        }

      }
    }
  }

  // ===================== Bindings =====================

  updateAccount = Accounts.updateAccount.bind(this);
  getHistoryCandles = Candles.getHistoryCandles.bind(this);
  ensureHistoryReady = Candles.ensureHistoryReady.bind(this);
  closeCandle = Candles.closeCandle.bind(this);
  updateCandleByTrade = Candles.updateCandleByTrade.bind(this);
  getCandleValueStatus = Candles.getCandleValueStatus.bind(this);
  getSymbolCandlesState = Candles.getSymbolCandlesState.bind(this);
  getSymbolIndocatorState = Candles.getSymbolIndocatorState.bind(this);

  openOrder = Orders.openOrder.bind(this);
  closeOrder = Orders.closeOrder.bind(this);
  isOpenOrder = Orders.isOpenOrder.bind(this);
  isOpenPosition = Orders.isOpenPosition.bind(this);
  changeLeverage = Orders.changeLeverage.bind(this);
  getPermissibleQuantity = Orders.getPermissibleQuantity.bind(this);
  closeAll = Orders.closeAll.bind(this);

  // ===================== Handlers =====================

  onTradeHandler = async (
    ...args: Parameters<typeof Handlers.onTradeHandler>
  ) => {
    if (!this.isReady) {
      this.logger.warn(`[onTradeHandler] Detector not ready yet, skip trade`);
      return;
    }
    return Handlers.onTradeHandler.bind(this)(...args);
  };

  onOrderBookUpdateHandler = async (
    ...args: Parameters<typeof Handlers.onOrderBookUpdateHandler>
  ) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onOrderBookUpdateHandler] Detector not ready yet, skip orderbook`,
      );
      return;
    }
    return Handlers.onOrderBookUpdateHandler.bind(this)(...args);
  };

  onAccountUpdateHandler = async (
    ...args: Parameters<typeof Handlers.onAccountUpdateHandler>
  ) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onAccountUpdateHandler] Detector not ready yet, skip account update`,
      );
      return;
    }
    return Handlers.onAccountUpdateHandler.bind(this)(...args);
  };

  onOrderCreateHandler = async (
    ...args: Parameters<typeof Handlers.onOrderCreateHandler>
  ) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onOrderCreateHandler] Detector not ready yet, skip order create`,
      );
      return;
    }
    return Handlers.onOrderCreateHandler.bind(this)(...args);
  };

  onOrderCloseHandler = async (
    ...args: Parameters<typeof Handlers.onOrderCloseHandler>
  ) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onOrderCloseHandler] Detector not ready yet, skip order close`,
      );
      return;
    }
    return Handlers.onOrderCloseHandler.bind(this)(...args);
  };

  onInspectorRegulationHandler = async (
    ...args: Parameters<typeof Handlers.onInspectorRegulationHandler>
  ) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onInspectorRegulationHandler] Detector not ready yet, skip regulation`,
      );
      return;
    }
    return Handlers.onInspectorRegulationHandler.bind(this)(...args);
  };

  // ===================== Candle Handlers (через mapper) =====================

  onCandleUpdateHandler = async (
    candle: Candle,
    connectorType: ConnectorType,
    marketType: MarketType,
  ) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onCandleUpdateHandler] Detector not ready yet, skip candle`,
      );
      return;
    }
    return this.onCandleUpdate(candle, null, connectorType, marketType);
  };

  onCandleOpenHandler = async (candle: Candle, connectorType: ConnectorType, marketType: MarketType) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onCandleOpenHandler] Detector not ready yet, skip candle`,
      );
      return;
    }
    return this.onCandleOpen(candle, connectorType, marketType);
  };

  onCandleCloseHandler = async (candle: Candle, connectorType: ConnectorType, marketType: MarketType) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onCandleCloseHandler] Detector not ready yet, skip candle`,
      );
      return;
    }
    return this.onCandleClose(candle, connectorType, marketType);
  };


  onSymbolsUpdateHandler = async (symbols: Symbol[], connectorType: ConnectorType, marketType: MarketType) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onSymbolsUpdateHandler] Detector not ready yet, skip symbols update`,
      );
      return;
    }
    return this.onSymbolsUpdate(symbols, connectorType, marketType);
  };

  onSymbolPricesUpdateHandler = async (price: SymbolPrice, connectorType: ConnectorType, marketType: MarketType) => {
    if (!this.isReady) {
      this.logger.warn(
        `[onSymbolPricesUpdateHandler] Detector not ready yet, skip price update`,
      );
      return;
    }
    return this.onSymbolPricesUpdate(price, connectorType, marketType);
  };



  // ===================== Plugins =====================


  registerPlugins(plugins: PluginInterface[]): void {
    this.pluginsForRegister = plugins.filter(Boolean);
    this.plugins.push(...this.pluginsForRegister);

    this.logger.debug(
      `[registerPlugins] Registered ${this.pluginsForRegister.length} plugin(s): ${this.pluginsForRegister
        .map((p) => (p?.constructor?.name ?? typeof p))
        .join(', ')}`,
    );
  }

  findPlugin = Plugins.findPlugin.bind(this);
  createPluginContext = Plugins.createPluginContext.bind(this);

  updateOptions = Utils.updateOptions.bind(this);
  getSymbolsLastTrades = Utils.getSymbolsLastTrades.bind(this);
  getName = Utils.getName.bind(this);
  getStringTime = Utils.getStringTime.bind(this);
  sendMessage = Utils.sendMessage.bind(this);

  // ===================== Hooks (стратегии переопределяют) =====================

  protected onInit() { }
  protected onStart() { }
  protected onTrade(_trade: Trade, _connectorType: ConnectorType, _marketType: MarketType) { }
  protected onCandleUpdate(_candle: Candle, _trade: Trade | null, _connectorType: ConnectorType, _marketType: MarketType) { }
  protected onCandleOpen(_candle: Candle, _connectorType: ConnectorType, _marketType: MarketType) { }
  protected onCandleClose(_candle: Candle, _connectorType: ConnectorType, _marketType: MarketType) { }
  protected onOrderBookUpdate(_orderbook: OrderBook, _connectorType: ConnectorType, _marketType: MarketType) { }
  protected onAccountUpdate(_account: Account) { }
  protected onOrderOpen(_order: Order, _account: Account) { }
  protected onOrderClose(_order: Order, _account: Account) { }
  protected onInspectorRegulation(_inspectorRegulation: InspectorRegulation, _account: Account) { }
  protected onSymbolsUpdate(_symbols: Symbol[], _connectorType?: ConnectorType, _marketType?: MarketType) { }
  protected onSymbolPricesUpdate(_price: SymbolPrice, _connectorType?: ConnectorType, _marketType?: MarketType) { }
}
