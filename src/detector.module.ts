import {
    Module,
    DynamicModule,
    Provider,
    forwardRef,
    Logger,
    Type,
} from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DetectorController } from './detector.controller';
import { KeyModule, KeyService } from '@barfinex/key';
import { ConnectorModule } from '@barfinex/connectors';
import { OrderService } from '@barfinex/orders';
import { PluginDriverModule } from '@barfinex/plugin-driver';
import { DetectorCoreModule } from './detector-core.module';
import {
    DetectorConfig,
    DetectorModuleConfig,
    PluginMeta,
} from '@barfinex/types';

@Module({})
export class DetectorModule {
    private static readonly logger = new Logger(DetectorModule.name);

    static register(config: DetectorModuleConfig): DynamicModule {
        this.logger.debug(
            `🔍 DetectorModule.register → config.plugins: ${JSON.stringify(
                config.plugins,
                null,
                2,
            )}`,
        );

        // 🔹 Базовые провайдеры
        const providers: Provider[] = [OrderService, KeyService];

        const pluginModules: Array<Type<any>> = config.plugins?.modules ?? [];
        const pluginMetas: PluginMeta[] = config.plugins?.metas ?? [];

        // 🔹 Подготовка финальных модулей и метаданных
        const finalModules = pluginModules.filter(Boolean);
        const finalMetas = pluginMetas.filter(Boolean);
        const finalProviders = providers.filter(Boolean);

        this.logger.log(
            `📦 Loaded external plugin modules: ${finalModules
                .map((m) => m?.name)
                .join(', ')}`,
        );
        this.logger.log(
            `📝 Loaded external plugin metas: ${finalMetas
                .map((m) => m?.title ?? '❌ missing title')
                .join(', ')}`,
        );
        this.logger.log(
            `👷 Base providers: [${finalProviders
                .map((p) => (typeof p === 'function' ? p.name : (p as any)?.provide))
                .join(', ')}]`,
        );

        return {
            module: DetectorModule,
            global: true,
            imports: [
                HttpModule.register({ timeout: 5000, maxRedirects: 5 }),
                ConnectorModule,
                KeyModule,
                forwardRef(() => PluginDriverModule),
                DetectorCoreModule,
                ...finalModules,
            ],
            controllers: [DetectorController],
            providers: [
                ...finalProviders,
                { provide: 'DETECTOR_CONFIG', useValue: config },
                {
                    provide: 'DETECTOR_PATH',
                    useFactory: (cfg: DetectorConfig) => cfg?.path ?? './instances',
                    inject: ['DETECTOR_CONFIG'],
                },
                { provide: 'PLUGIN_METAS', useValue: finalMetas },
            ],
            exports: ['DETECTOR_CONFIG', 'DETECTOR_PATH', 'PLUGIN_METAS', DetectorCoreModule],
        };
    }
}
