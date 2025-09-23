import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PluginMeta } from '@barfinex/types';

@Injectable()
export class PluginService {
  private readonly logger = new Logger(PluginService.name);
  private readonly studioApiUrl: string;

  constructor() {
    // URL Studio API — должен быть в ENV
    this.studioApiUrl = process.env.STUDIO_API_URL || 'http://localhost:8011/api';
  }

  /**
   * Получить метаданные плагина по studioGuid
   */
  async getPluginByGuid(userId: number, studioGuid: string): Promise<PluginMeta | null> {
    try {
      const url = `${this.studioApiUrl}/plugins/${studioGuid}`;
      const res = await axios.get<PluginMeta>(url, {
        headers: {
          Authorization: `Bearer ${process.env.STUDIO_API_TOKEN}`, // если требуется
          'x-user-id': userId, // если API требует userId
        },
      });
      return res.data;
    } catch (e) {
      this.logger.error(`Failed to fetch plugin ${studioGuid}: ${e}`);
      return null;
    }
  }

  /**
   * Получить список плагинов текущего пользователя
   */
  async getPlugins(userId: number): Promise<PluginMeta[]> {
    try {
      const url = `${this.studioApiUrl}/plugins`;
      const res = await axios.get<{ data: PluginMeta[] }>(url, {
        headers: {
          Authorization: `Bearer ${process.env.STUDIO_API_TOKEN}`,
          'x-user-id': userId,
        },
      });
      return res.data.data;
    } catch (e) {
      this.logger.error(`Failed to fetch plugins: ${e}`);
      return [];
    }
  }
}
