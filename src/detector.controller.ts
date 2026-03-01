import {
    Controller,
    Get,
    Param,
    Post,
    Query,
} from '@nestjs/common';
import { EventPattern } from '@nestjs/microservices';
import { DetectorManagerService } from './detector-manager.service';
import {
    Candle,
    Trade,
    OrderBook,
    AccountEvent,
    ConnectorType,
    MarketType,
    Order,
    Symbol,
    SymbolPrice,
    InspectorRiskPayload,
    BaseEvent,
    SubscriptionType,
} from '@barfinex/types';
import { CurrentUser } from './decorators/current-user.decorator';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiParam,
    ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Detector')
@Controller('detector')
export class DetectorController {
    constructor(private readonly detectorManager: DetectorManagerService) { }

    /* ----------------- PROVIDER EVENTS ----------------- */
    // Эти методы EventPattern не попадают в Swagger, но обрабатываются MQ события

    @EventPattern('PROVIDER_MARKETDATA_TRADE')
    async handleTrades(
        data: { value: Trade; options: { connectorType: ConnectorType; marketType: MarketType } },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value, options } = data;
            await active.onTradeHandler(value, options.connectorType, options.marketType);
        }
    }

    @EventPattern('PROVIDER_MARKETDATA_ORDERBOOK')
    async handleOrderBooks(
        data: { value: OrderBook; options: { connectorType: ConnectorType; marketType: MarketType } },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value, options } = data;
            await active.onOrderBookUpdateHandler(value, options.connectorType, options.marketType);
        }
    }

    @EventPattern('PROVIDER_MARKETDATA_CANDLE')
    async handleCandles(
        data: { value: Candle; options: { connectorType: ConnectorType; marketType: MarketType } },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value, options } = data;
            await active.onCandleUpdateHandler(value, options.connectorType, options.marketType);
        }
    }

    @EventPattern('PROVIDER_ACCOUNT_EVENT')
    async handleAccountUpdates(
        data: { value: AccountEvent; options: { connectorType: ConnectorType; marketType: MarketType } },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value } = data;
            await active.onAccountUpdateHandler(value);
        }
    }

    @EventPattern('PROVIDER_ORDER_CREATE')
    async handleOrderCreate(
        data: { value: Order; options: { connectorType: ConnectorType; marketType: MarketType } },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value } = data;
            await active.onOrderCreateHandler(value);
        }
    }

    @EventPattern('PROVIDER_ORDER_CLOSE')
    async handleOrderClose(
        data: { value: Order; options: { connectorType: ConnectorType; marketType: MarketType } },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value } = data;
            await active.onOrderCloseHandler(value);
        }
    }

    @EventPattern('PROVIDER_SYMBOLS')
    async handleSymbolsUpdates(
        data: { value: Symbol[]; options: { connectorType: ConnectorType; marketType: MarketType } },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value, options } = data;
            await active.onSymbolsUpdateHandler(value, options.connectorType, options.marketType);
        }
    }

    @EventPattern('PROVIDER_SYMBOL_PRICES')
    async handleSymbolPricesUpdates(
        data: { value: SymbolPrice; options: { connectorType: ConnectorType; marketType: MarketType } },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value, options } = data;
            await active.onSymbolPricesUpdateHandler(value, options.connectorType, options.marketType);
        }
    }

    @EventPattern('INSPECTOR_RISK_LIMIT_BREACH')
    @EventPattern('INSPECTOR_RISK_KILL_SWITCH')
    async handleInspectorRegulation(
        data: {
            value:
                | { detectorSysname: string; opt: { isActive: boolean } }
                | BaseEvent<SubscriptionType.INSPECTOR_RISK_LIMIT_BREACH, { detectorSysname: string; opt: { isActive: boolean } }>
                | InspectorRiskPayload;
            options: { connectorType: ConnectorType; marketType: MarketType };
        },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value } = data;
            if ('detectorSysname' in value) {
                await active.onInspectorRegulationHandler(value);
                return;
            }
            if ('payload' in value && 'detectorSysname' in value.payload) {
                await active.onInspectorRegulationHandler(value.payload);
            }
        }
    }

    /* ----------------- DETECTOR MANAGEMENT ----------------- */
    @Get('select')
    @ApiOperation({ summary: 'Переключить активный детектор' })
    @ApiQuery({ name: 'sysName', required: true, description: 'Системное имя детектора' })
    @ApiResponse({ status: 200, description: 'Успешное переключение' })
    async selectDetector(@Query('sysName') sysName: string) {
        if (!sysName) {
            return { success: false, message: 'sysName query param is required' };
        }

        try {
            await this.detectorManager.switchDetector(sysName);
            return { success: true, message: `Detector switched to ${sysName}` };
        } catch (err: any) {
            return { success: false, message: `Failed to switch detector: ${err.message}` };
        }
    }

    @Get('active')
    @ApiOperation({ summary: 'Получить активный детектор' })
    @ApiResponse({ status: 200, description: 'Информация об активном детекторе' })
    getActiveDetector() {
        const active = this.detectorManager.getActiveDetector();
        return active
            ? { success: true, sysName: active.options.sysname }
            : { success: false, message: 'No active detector' };
    }

    @Get('health')
    @ApiOperation({ summary: 'Health check активного детектора' })
    @ApiResponse({ status: 200, description: 'Состояние готовности и базовые метрики' })
    getHealth() {
        const active = this.detectorManager.getActiveDetector();
        if (!active) {
            return { ok: false, hasActiveDetector: false, message: 'No active detector' };
        }
        return {
            ok: true,
            hasActiveDetector: true,
            sysName: active.options.sysname,
            isReady: active.isReady,
            providers: active.options.providers?.length ?? 0,
            symbols: active.options.symbols?.length ?? 0,
            timestamp: Date.now(),
        };
    }

    @Get('state')
    @ApiOperation({ summary: 'Расширенное состояние активного детектора' })
    @ApiResponse({ status: 200, description: 'Опции, performance и runtime-состояние' })
    getState() {
        const active = this.detectorManager.getActiveDetector();
        if (!active) {
            return { success: false, message: 'No active detector' };
        }
        return {
            success: true,
            sysName: active.options.sysname,
            isReady: active.isReady,
            options: active.options,
            performance: active.getPerformanceSnapshot(),
            timestamp: Date.now(),
        };
    }

    @Get('options')
    @ApiOperation({ summary: 'Конфигурация активного детектора' })
    @ApiResponse({ status: 200, description: 'Текущие options активного детектора' })
    getOptions() {
        const active = this.detectorManager.getActiveDetector();
        if (!active) {
            return { success: false, message: 'No active detector' };
        }
        return {
            success: true,
            options: active.options,
            previousOptions: active.getOptionsPrev?.() ?? null,
        };
    }

    @Get('accounts')
    @ApiOperation({ summary: 'Аккаунты активного детектора' })
    @ApiResponse({ status: 200, description: 'Снимок аккаунтов, на которых работает детектор' })
    getAccounts() {
        const active = this.detectorManager.getActiveDetector();
        if (!active) {
            return { success: false, message: 'No active detector' };
        }
        const accounts = active.accounts ?? [];
        return {
            success: true,
            count: accounts.length,
            data: accounts,
        };
    }

    @Get('trades/last')
    @ApiOperation({ summary: 'Последние трейды по символам активного детектора' })
    @ApiResponse({ status: 200, description: 'Map последних трейдов по symbols' })
    getLastTrades() {
        const active = this.detectorManager.getActiveDetector();
        if (!active) {
            return { success: false, message: 'No active detector' };
        }
        return {
            success: true,
            data: active.getSymbolsLastTrades(),
        };
    }

    @Get('performance')
    @ApiOperation({ summary: 'Получить performance-метрики активного детектора' })
    @ApiResponse({ status: 200, description: 'Winrate, avg RR, time-in-trade' })
    getActiveDetectorPerformance() {
        const active = this.detectorManager.getActiveDetector();
        if (!active) {
            return { success: false, message: 'No active detector' };
        }
        return {
            success: true,
            sysName: active.options.sysname,
            performance: active.getPerformanceSnapshot(),
        };
    }

    /* ----------------- PLUGINS MANAGEMENT ----------------- */
    @Post('plugins/:studioGuid/install')
    @ApiTags('Plugins')
    @ApiOperation({ summary: 'Установить новый плагин' })
    @ApiParam({ name: 'studioGuid', description: 'GUID плагина' })
    @ApiResponse({ status: 201, description: 'Плагин установлен успешно' })
    async installPlugin(
        @Param('studioGuid') studioGuid: string,
        @CurrentUser() userId: number,
    ) {
        return this.detectorManager.installPlugin(studioGuid, userId);
    }

    @Get('plugins/installed')
    @ApiTags('Plugins')
    @ApiOperation({ summary: 'Список установленных плагинов' })
    @ApiResponse({ status: 200, description: 'Возвращает список плагинов с pluginApi URL' })
    async listInstalledPlugins(@CurrentUser() userId: number) {
        return this.detectorManager.listInstalledPlugins(userId);
    }

    @Get('plugins/:studioGuid')
    @ApiTags('Plugins')
    @ApiOperation({ summary: 'Детали установленного плагина' })
    @ApiParam({ name: 'studioGuid', description: 'GUID плагина' })
    @ApiResponse({ status: 200, description: 'Детальная информация о плагине' })
    async getPlugin(
        @CurrentUser() userId: number,
        @Param('studioGuid') studioGuid: string,
    ) {
        return this.detectorManager.getPluginDetails(userId, studioGuid);
    }
}
