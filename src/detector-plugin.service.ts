import { Logger } from '@nestjs/common';
import {
    PluginInterface,
    PluginMeta,
    PluginHook,
    PluginContext,
    Account,
    Order,
    Trade,
    Candle,
    OrderBook,
    InspectorRegulation,
} from '@barfinex/types';

/**
 * Базовый сервис для всех плагинов детектора.
 * Реализует PluginInterface с заглушками, которые можно переопределить.
 */
export abstract class DetectorPluginService implements PluginInterface {
    protected readonly logger: Logger;

    abstract readonly name: string;
    abstract readonly meta: PluginMeta;

    /** Публичный API плагина (каждый сервис реализует свой) */
    abstract api: unknown;

    /** Конфигурация экземпляра (UI → options) */
    options: Record<string, unknown> = {};

    constructor() {
        // 👇 Автоматически берем имя конкретного класса
        this.logger = new Logger(this.constructor.name);
    }

    // ================= PluginInterface hooks =================

    async [PluginHook.onInit](_ctx: PluginContext): Promise<void> { }
    async [PluginHook.onStart](_ctx: PluginContext): Promise<void> { }
    async [PluginHook.onDispose](_ctx: PluginContext): Promise<void> { }

    async [PluginHook.onTrade](_ctx: PluginContext, _trade: Trade): Promise<void> { }
    async [PluginHook.onAfterTrade](_ctx: PluginContext, _trade: Trade): Promise<void> { }

    async [PluginHook.onAccountUpdate](_ctx: PluginContext, _account: Account): Promise<void> { }
    async [PluginHook.onAfterAccountUpdate](_ctx: PluginContext, _account: Account): Promise<void> { }

    async [PluginHook.onCandleUpdate](_ctx: PluginContext, _candle: Candle): Promise<void> { }
    async [PluginHook.onAfterCandleUpdate](_ctx: PluginContext, _candle: Candle): Promise<void> { }

    async [PluginHook.onCandleOpen](_ctx: PluginContext, _candle: Candle): Promise<void> { }
    async [PluginHook.onAfterCandleOpen](_ctx: PluginContext, _candle: Candle): Promise<void> { }

    async [PluginHook.onCandleClose](_ctx: PluginContext, _candle: Candle): Promise<void> { }
    async [PluginHook.onAfterCandleClose](_ctx: PluginContext, _candle: Candle): Promise<void> { }

    async [PluginHook.onOrderBookUpdate](_ctx: PluginContext, _orderBook: OrderBook): Promise<void> { }
    async [PluginHook.onAfterOrderBookUpdate](_ctx: PluginContext, _orderBook: OrderBook): Promise<void> { }

    async [PluginHook.onOrderOpen](_ctx: PluginContext, _order: Order): Promise<void> { }
    async [PluginHook.onAfterOrderOpen](_ctx: PluginContext, _order: Order): Promise<void> { }

    async [PluginHook.onOrderClose](_ctx: PluginContext, _order: Order): Promise<void> { }
    async [PluginHook.onAfterOrderClose](_ctx: PluginContext, _order: Order): Promise<void> { }

    async [PluginHook.onInspectorRegulation](_ctx: PluginContext, _reg: InspectorRegulation): Promise<void> { }
    async [PluginHook.onAfterInspectorRegulation](_ctx: PluginContext, _reg: InspectorRegulation): Promise<void> { }
}
