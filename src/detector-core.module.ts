import { Module, forwardRef } from '@nestjs/common';
import { DetectorManagerService } from './detector-manager.service';
import { PluginDriverModule } from '@barfinex/plugin-driver';
import { ConnectorModule } from '@barfinex/connectors';
import { KeyModule } from '@barfinex/key';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { OrderService } from '@barfinex/orders';
import { ConfigModule } from '@nestjs/config';
import { PluginService } from './plugin.service';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [
        ConfigModule, // глобальный конфиг (dotenv и пр.)
        ConnectorModule,
        KeyModule,

        // ✅ Подключение MongoDB (единое на всё приложение)
        TypeOrmModule.forRoot({
            type: 'mongodb',
            host: process.env.MONGO_HOST,
            port: Number(process.env.MONGO_PORT || 27017),
            username: process.env.MONGO_ROOT_USERNAME,
            password: process.env.MONGO_ROOT_PASSWORD,
            database: process.env.MONGO_DATABASE,
            authSource: 'admin',
            autoLoadEntities: true, // автоматически регистрирует все *.entity.ts
            synchronize: true, // ⚠️ только для dev (в проде отключить!)
        }),

        // Клиент для общения с провайдером через Redis
        ClientsModule.register([
            {
                name: 'PROVIDER_SERVICE',
                transport: Transport.REDIS,
                options: {
                    host: process.env.REDIS_HOST,
                    port: +(process.env.REDIS_PORT || 6379),
                    retryAttempts: 10,
                    retryDelay: 5000,
                },
            },
        ]),

        forwardRef(() => PluginDriverModule),
    ],
    providers: [
        PluginService,
        DetectorManagerService,
        OrderService, // если нет отдельного OrderModule
        // 👇 здесь больше нет PLUGIN_METAS
    ],
    exports: [
        PluginService,
        DetectorManagerService,
        ClientsModule,
        // 👇 PLUGIN_METAS теперь экспортируется из DetectorModule
    ],
})
export class DetectorCoreModule { }
