import type { Detector } from '@barfinex/types';

export function getDefaultOptions(): Detector {

  return { key: '', sysname: '', logLevel: '', currency: '', useNotifications: { telegram: { token: '', chatId: '', messageFormat: '', isActive: false } }, advisor: undefined, restApiUrl: '', providers: [], symbols: [], orders: [], intervals: [], indicators: [], useSandbox: false, useScratch: false, subscriptions: [] } as unknown as Detector;

}
export function getOptionsPrev(this: any): Detector | undefined { return this.optionsPrev; }

export function setOptionsPrev(this: any, options: Detector): void { this.optionsPrev = options; }