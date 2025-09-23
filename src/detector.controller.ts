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

    @EventPattern('INSPECTOR_EVENT')
    async handleInspectorRegulation(
        data: { value: { detectorSysname: string; opt: any }; options: { connectorType: ConnectorType; marketType: MarketType } },
    ) {
        const active = this.detectorManager.getActiveDetector();
        if (active) {
            const { value } = data;
            await active.onInspectorRegulationHandler(value);
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
