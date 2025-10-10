import * as path from 'path';
import * as fs from 'fs';
import { Provider, Type } from '@nestjs/common';
import { PluginMeta } from '@barfinex/types';
import { providerUtils } from '@barfinex/utils';


export interface DetectorBundle {
    service: Type<any>;
    providers: Provider[];
    configClass?: Type<any>;
    optionsProvider?: Provider;
    pluginModules?: any[];
    pluginMetas?: PluginMeta[];
}

function toKebab(v: string) {
    return v
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[_\s]+/g, '-')
        .toLowerCase();
}

function firstExisting(paths: string[]) {
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return undefined;
}

export default function dynamicDetector(
    folder: string,
    sysName: string,
): DetectorBundle | null {
    try {
        const baseNames = [sysName, toKebab(sysName), sysName.toLowerCase()];
        const exts = ['.js', '.mjs', '.cjs', '.ts'];

        // =============================
        // 1) Поиск SERVICE
        // =============================
        const serviceCandidates: string[] = [];
        for (const n of baseNames) {
            for (const ext of exts)
                serviceCandidates.push(path.join(folder, n, `${n}.service${ext}`));
            for (const ext of exts)
                serviceCandidates.push(path.join(folder, `${n}.service${ext}`));
            for (const ext of exts)
                serviceCandidates.push(path.join(folder, n, `index${ext}`));
        }

        const servicePath =
            firstExisting(serviceCandidates) ||
            firstExisting(serviceCandidates.map((p) => path.resolve(process.cwd(), p)));

        if (!servicePath) {
            console.error(
                `❌ Service file not found for detector "${sysName}". Tried:\n${serviceCandidates.join(
                    '\n',
                )}`,
            );
            return null;
        }

        // =============================
        // 2) Поиск CONFIG
        // =============================
        const serviceDir = path.dirname(servicePath);
        const configCandidates: string[] = [];

        for (const n of baseNames) {
            for (const ext of exts)
                configCandidates.push(path.join(serviceDir, `${n}.config${ext}`));
            for (const ext of exts)
                configCandidates.push(path.join(serviceDir, `index${ext}`));
        }
        for (const n of baseNames) {
            for (const ext of exts)
                configCandidates.push(path.join(folder, n, `${n}.config${ext}`));
            for (const ext of exts)
                configCandidates.push(path.join(folder, `${n}.config${ext}`));
            for (const ext of exts)
                configCandidates.push(path.join(folder, n, `index${ext}`));
        }

        const configPath =
            firstExisting(configCandidates) ||
            firstExisting(configCandidates.map((p) => path.resolve(process.cwd(), p)));

        // =============================
        // 3) require модулей
        // =============================
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const serviceModule = require(servicePath);
        const configModule = configPath ? require(configPath) : {};

        const ServiceClass = Object.values(serviceModule).find(
            (exp) => typeof exp === 'function' && exp.name.endsWith('Service'),
        ) as Type<any> | undefined;

        if (!ServiceClass) {
            console.error(`❌ No Service class found in ${servicePath}`);
            return null;
        }

        const ConfigClass = Object.values(configModule).find(
            (exp) => typeof exp === 'function' && exp.name.endsWith('ConfigService'),
        ) as Type<any> | undefined;

        // =============================
        // 4) Поиск optionsProvider
        // =============================
        const OptionsProvider = Object.values(configModule).find(
            (exp) =>
                exp &&
                typeof exp === 'object' &&
                'provide' in (exp as any) &&
                (
                    (exp as any).provide === 'DETECTOR_OPTIONS' ||
                    (exp as any).provide?.toString().includes('OPTIONS')
                ),
        ) as Provider | undefined;

        // =============================
        // 5) Плагины
        // =============================
        const pluginModules: any[] = (configModule.pluginModules as any[]) ?? [];
        const pluginMetas: PluginMeta[] = (configModule.pluginMetas as PluginMeta[]) ?? [];

        // =============================
        // 6) Providers
        // =============================
        const providers: Provider[] = [];

        if (ConfigClass) {
            providers.push(ConfigClass);
            providers.push({ provide: 'DETECTOR_CONFIG_SERVICE', useExisting: ConfigClass });
        }
        if (OptionsProvider) {
            providers.push(OptionsProvider);
        }

        // =============================
        // 7) Logging
        // =============================
        console.log(
            `[dynamicDetector] service: ${servicePath}\n` +
            `[dynamicDetector] config: ${configPath ?? '(not found)'}\n` +
            `[dynamicDetector] providers: [${providers.map(providerUtils.providerName).join(', ')}]\n` +
            `📦 Loaded plugin modules: [${pluginModules.map((m) => m?.name).join(', ')}]\n` +
            `📝 Loaded plugin metas: [${pluginMetas.map((m) => m?.title).join(', ')}]`,
        );

        return {
            service: ServiceClass,
            providers,
            configClass: ConfigClass,
            optionsProvider: OptionsProvider,
            pluginModules,
            pluginMetas,
        };
    } catch (err: any) {
        console.error(
            `❌ Error loading detector "${sysName}":`,
            err?.stack || err?.message,
        );
        return null;
    }
}
