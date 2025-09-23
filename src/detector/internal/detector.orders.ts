import type { Order, Provider, Symbol, OrderSide, ConnectorType, MarketType, Account, OrderPermissibleQuantity } from '@barfinex/types';

export async function openOrder(this: any, order: Order, provider: Provider): Promise<Order> {

  const { order: orderResult, account, openOrderMoment } = await this.orderService.openOrder({ order, openOrderMoment: this.openOrderMoment, account: undefined, providerRestApiUrl: provider.restApiToken });
  this.updateAccount(account); this.openOrderMoment = openOrderMoment; return { ...orderResult };

}

export async function closeOrder(this: any, order: Order, closePrice: number, provider: Provider): Promise<Order> {

  const { order: orderResult, account } = await this.orderService.closeOrder({ order, closePrice, providerRestApiUrl: provider.restApiUrl });
  this.onOrderCloseHandler(order, order.connectorType, order.marketType); this.updateAccount(account); return { ...orderResult };

}

export function isOpenOrder(this: any, symbol: Symbol, side?: OrderSide): boolean {

  if (!side) return !!this.accounts.find((a: Account) => a.orders.find((o: Order) => o.symbol == symbol));
  return !!this.accounts.find((a: Account) => a.orders.find((o: Order) => o.symbol == symbol && o.side == side));

}

export function isOpenPosition(this: any, symbol: Symbol, side?: OrderSide): boolean {

  if (!side) return !!this.accounts.find((a: Account) => a.positions.find((o: any) => o.symbol == symbol));
  return !!this.accounts.find((a: Account) => a.positions.find((o: any) => o.symbol == symbol && o.side == side));

}

export async function changeLeverage(this: any, options: { connectorType: ConnectorType; marketType: MarketType; symbol: Symbol; newLeverage: number; provider: Provider }): Promise<Symbol> {

  const { connectorType, marketType, symbol, newLeverage, provider } = options;
  this.connectorService.changeAccountSymbolLeverage({ providerRestApiUrl: provider.restApiToken, connectorType, marketType, symbol, newLeverage });
  return { ...symbol, leverage: newLeverage };

}

export function getPermissibleQuantity(
  this: any,
  account: Account,
  symbol: Symbol,
  price: number,
  provider: Provider
): OrderPermissibleQuantity {
  const result: OrderPermissibleQuantity = {
    acceptable: false,
    acceptableQuantityMin: 0,
    acceptableQuantityMax: 0,
    entryQuantityDefaultPercent: 0,
    entryBalanceDefault: 0,
    entryBalanceMax: 0,
    permissibleQuantityDefaultPercent: 0,
  };

  if (account.assets.length > 0 || account.positions.length > 0 || account.orders.length > 0) {
    // безопасный поиск USDT
    const usdtAsset = account.assets.find((q) => q.symbol?.name === "USDT");
    const availableBalance = usdtAsset?.availableBalance ?? 0;
    const walletBalance = usdtAsset?.walletBalance ?? 0;

    result.permissibleQuantityDefaultPercent = this.options?.tradeSettings?.maxPositionSizePercent ?? 0;

    result.entryBalanceMax = (walletBalance * result.permissibleQuantityDefaultPercent) / 100;
    if (result.entryBalanceMax > availableBalance) {
      result.entryBalanceMax = availableBalance;
    }

    const entryQuantityDefaultPercent =
      provider.connectors?.
        find((c: any) => c.connectorType == account.connectorType)
        ?.markets.find((m: any) => m.marketType == account.marketType)
        ?.symbols.find((s: any) => s.name == symbol.name)?.quantity ?? 0;

    result.entryQuantityDefaultPercent = entryQuantityDefaultPercent;
    result.entryBalanceDefault = price * entryQuantityDefaultPercent;

    if (result.entryBalanceDefault <= result.entryBalanceMax && entryQuantityDefaultPercent > 0) {
      result.acceptableQuantityMin = entryQuantityDefaultPercent;
      result.acceptableQuantityMax =
        Math.floor(result.entryBalanceMax / result.entryBalanceDefault) * entryQuantityDefaultPercent;
      result.acceptable = true;
    }
  }

  return result;
}


export async function closeAll(this: any): Promise<Order[]> { return []; }