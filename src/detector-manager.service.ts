import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DetectorService } from './detector/detector.service';
import dynamicDetector from './dynamic-detector';
import {
  Detector,
  DetectorConfig,
  buildDetectorConfig,
  PluginMeta,
} from '@barfinex/types';
import { ConnectorService } from '@barfinex/connectors';
import { OrderService } from '@barfinex/orders';
import { PluginDriverService } from '@barfinex/plugin-driver';
import { KeyService } from '@barfinex/key';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { promises as fs } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { PluginService } from './plugin.service';


@Injectable()
export class DetectorManagerService implements OnModuleInit {
  private readonly logger = new Logger(DetectorManagerService.name);

  private activeDetector: DetectorService | null = null;

  private pluginsDir = join(process.cwd(), 'plugins');

  constructor(
    private readonly pluginDriverService: PluginDriverService,
    private readonly connectorService: ConnectorService,
    private readonly keyService: KeyService,
    private readonly orderService: OrderService,
    private readonly configService: ConfigService,
    private readonly pluginService: PluginService,
    @Inject('PROVIDER_SERVICE') private readonly client: ClientProxy,

    // 👇 теперь это всегда PluginMeta[] (без многомерных массивов)
    @Optional() @Inject('PLUGIN_METAS') private readonly builtinPlugins: PluginMeta[] = [],

    @Optional() @Inject('DETECTOR_PATH') private readonly injectedDetectorPath?: string,
    @Optional() @Inject('DETECTOR_CONFIG') private readonly injectedDetectorConfig?: DetectorConfig,
  ) { }

  public getActiveDetector(): DetectorService | null {
    return this.activeDetector;
  }

  /* ---------------- DETECTOR SWITCH ---------------- */
  public async switchDetector(
    sysName: string,
    options: Partial<Detector> = {},
  ): Promise<void> {
    this.logger.log(`[switchDetector] Switching to sysName=${sysName}`);

    if (this.activeDetector) {
      try {
        await this.activeDetector.onModuleDestroy();
      } catch (e) {
        this.logger.error(
          `[switchDetector] Error stopping old detector: ${(e as Error).message}`,
        );
      }
    }

    const detectorPath =
      this.injectedDetectorPath ||
      this.injectedDetectorConfig?.path ||
      this.configService.get<string>('detector.path') ||
      './instances';

    this.logger.log(
      `Loading detector from path: ${detectorPath}, sysName: ${sysName}`,
    );

    const bundle = dynamicDetector(detectorPath, sysName);
    if (!bundle) throw new Error(`Detector class for sysName=${sysName} not found`);

    if (!bundle.configClass) {
      throw new Error(`[switchDetector] No ConfigService found for ${sysName}`);
    }
    const localConfigService = new bundle.configClass();

    const baseInitial = buildDetectorConfig(localConfigService.detector);

    const normalizedSysName =
      (options as any).sysName ??
      (options as any).sysname ??
      (baseInitial as any).sysName ??
      (baseInitial as any).sysname ??
      sysName;

    const mergedInitial: Partial<Detector> = {
      ...baseInitial,
      ...options,
      sysname: normalizedSysName,
      providers:
        Array.isArray((options as any).providers) &&
          (options as any).providers.length > 0
          ? (options as any).providers
          : (baseInitial as any).providers,
    };

    const DetectorClass = bundle.service;
    const detector: DetectorService = new DetectorClass(
      this.pluginDriverService,
      this.connectorService,
      this.keyService,
      this.orderService,
      this.configService,
      this.client,
      localConfigService,
      mergedInitial,
    );

    if (typeof (detector as any).initDetectorLifecycle === 'function') {
      await (detector as any).initDetectorLifecycle();
    }

    if (typeof (detector as any).initializeDetector === 'function') {
      await (detector as any).initializeDetector();
    }

    this.activeDetector = detector;
    this.logger.log(`[switchDetector] Now active: ${normalizedSysName}`);
  }

  async onModuleInit() {
    const envSysName = process.env.DETECTOR_SYSNAME;
    const cfg = this.injectedDetectorConfig;
    const sysName = envSysName || cfg?.sysName;

    if (sysName) {
      this.logger.log(`[onModuleInit] Auto-selecting detector: ${sysName}`);
      await this.switchDetector(sysName, {
        sysname: sysName,
        logLevel: (cfg as any)?.logLevel,
      });
    } else {
      this.logger.warn(`[onModuleInit] No DETECTOR_SYSNAME or config.sysName found`);
    }
  }

  /* ---------------- PLUGIN INSTALLATION ---------------- */
  async installPlugin(studioGuid: string, userId: number) {
    const plugin: PluginMeta | null =
      await this.pluginService.getPluginByGuid(userId, studioGuid);

    if (!plugin) {
      throw new NotFoundException(`Plugin ${studioGuid} not found`);
    }

    if (plugin.options?.registryType === 'bundle') {
      const url = plugin.options.sourceUrl as string;
      const res = await axios.get(url, { responseType: 'arraybuffer' });

      await fs.mkdir(this.pluginsDir, { recursive: true });
      const filePath = join(this.pluginsDir, `${plugin.studioGuid}.js`);

      await fs.writeFile(filePath, res.data);
      this.logger.log(`✅ Plugin bundle saved: ${filePath}`);

      if (!plugin.studioGuid) {
        throw new Error("plugin.studioGuid is required for dynamic plugin load");
      }

      await this.loadDynamicPlugin(plugin.studioGuid, filePath);

      return { success: true, message: `Plugin ${plugin.title} installed` };
    }

    if (plugin.options?.registryType === 'npm') {
      // TODO: execSync(`npm install ${plugin.options.packageName}@${plugin.version}`);
    }

    throw new BadRequestException('Unsupported registryType');
  }

  private async loadDynamicPlugin(studioGuid: string, filePath: string) {
    delete require.cache[require.resolve(filePath)];

    const mod = require(filePath);
    if (typeof mod.init !== 'function') {
      throw new Error(`Plugin ${studioGuid} does not export init()`);
    }

    mod.init({ detector: this });
    this.logger.log(`🚀 Plugin ${studioGuid} initialized`);
  }

  /* ---------------- PLUGIN QUERIES ---------------- */
  async listInstalledPlugins(userId: number) {
    // 1. встроенные (импортированные модули)
    const builtin = this.builtinPlugins ?? [];

    // 2. из Studio API
    const dynamic = await this.pluginService.getPlugins(userId);

    return [...builtin, ...dynamic].map((p) => ({
      studioGuid: p.studioGuid,
      title: p.title,
      version: p.version,
      visibility: p.visibility,
      pluginApi: p.pluginApi ?? `/plugins-api/${p.studioGuid}`,
    }));
  }

  async getPluginDetails(userId: number, studioGuid: string) {
    // сначала проверяем встроенные
    const builtin = (this.builtinPlugins || []).find(
      (p) => p.studioGuid === studioGuid,
    );
    if (builtin) {
      return { ...builtin, pluginApi: `/plugins-api/${builtin.studioGuid}` };
    }

    // если нет — берём из Studio API
    const plugin = await this.pluginService.getPluginByGuid(userId, studioGuid);
    if (!plugin) {
      throw new NotFoundException(`Plugin ${studioGuid} not found`);
    }
    return { ...plugin, pluginApi: `/plugins-api/${plugin.studioGuid}` };
  }
}
