import type { Account, Order } from '@barfinex/types';

export function updateAccount(this: any, updatedAccount: Account): void {

  const idx = this._accounts.findIndex((a: Account) => a.connectorType === updatedAccount.connectorType && a.marketType === updatedAccount.marketType);

  if (idx !== -1) {
    const current = this._accounts[idx];
    const mergedOrders = ([...(current.orders || []), ...(updatedAccount.orders || [])] as Order[])
      .reduce((acc: Order[], o: Order) => acc.find(x => x.externalId === o.externalId) ? acc : [...acc, o], []);
    const mergedPositions = ([...(current.positions || []), ...(updatedAccount.positions || [])] as any[])
      .reduce((acc: any[], p: any) => acc.find(x => x.symbol.name === p.symbol.name) ? acc : [...acc, p], []);
    this._accounts[idx] = { ...current, ...updatedAccount, orders: mergedOrders, positions: mergedPositions };
  }
  else this._accounts.push(updatedAccount);

}