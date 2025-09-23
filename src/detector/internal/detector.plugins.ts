import type { PluginInterface, Account, PluginContext, Symbol, Order } from '@barfinex/types';

export function findPlugin<T extends PluginInterface = PluginInterface>(key: string): T | undefined {
  console.log('🔍 findPlugin: looking for', key);
  console.log('this.plugins in Finding plugin:', this.plugins);

  return this.plugins.find((p: any) =>
    p.constructor?.name === key ||  // класс сервиса
    p.name === key ||               // поле name внутри сервиса
    p.meta?.studioGuid === key      // уникальный GUID плагина
  ) as T | undefined;
}



export function createPluginContext(this: any, account: Account): PluginContext {
  return {
    findPlugin: <T extends PluginInterface>(_name: string): T => ({} as T),
    detectorContext: {
      name: 'Example Detector',
      options: {
        key: '',
        sysname: '',
        logLevel: '',
        currency: '',
        useNotifications: {
          telegram: { token: '', chatId: '', messageFormat: '', isActive: false },
        },
        advisor: undefined,
        restApiUrl: '',
        providers: [],
        symbols: [],
        orders: [],
        intervals: [],
        indicators: [],
        useSandbox: false,
        useScratch: false,
        subscriptions: [],
      },
      account,
      candles: [],
      orders: account.orders,
    },
    tradingOperation: {
      closeAll: async (_symbol: Symbol): Promise<Order[]> => [],
    },
  } as unknown as PluginContext;
}
