import { DetectorService } from '../detector.service';
import {
  SubscriptionType,
  SubscriptionValue,
  DetectorEventType,
  Symbol,
} from '@barfinex/types';

/**
 * Регистрирует событие детектора и публикует его в Redis.
 *
 * @param eventType Тип события (например, CROSSING_MOVING_AVERAGE)
 * @param payload   Произвольные данные события, могут содержать symbols
 */
export function registerEvent(
  this: DetectorService,
  eventType: DetectorEventType,
  payload: { eventType: DetectorEventType, payload: any, symbols?: Symbol[]; },
): void {

  if (payload?.eventType != DetectorEventType.TICK_RECEIVED) {
    this.logger.error('❌ SubscriptionType.DETECTOR_EVENT is undefined');
    return;
  }


  if (!this.isEmitToRedisEnabled) {
    this.logger.warn(`⚠️ registerEvent(${eventType}) skipped → Redis emit disabled`);
    return;
  }

  const symbols = (payload.symbols as Symbol[] | undefined) ?? [];

  this.logger.debug(`➡️ Detector ${this.getName()} → registerEvent invoked`, {
    eventType,
    payload,
    extractedSymbols: symbols.map((s) => s.name),
    providers: this.options.providers,
  });

  for (const provider of this.options.providers ?? []) {
    for (const connector of provider.connectors ?? []) {
      if (!connector.isActive) continue;

      for (const market of connector.markets ?? []) {
        if (symbols.length === 0) {
          this.logger.warn(
            `⚠️ No symbols provided in payload for ${eventType} (connector=${connector.connectorType}, market=${market.marketType})`,
          );
          continue;
        }

        for (const symbol of symbols) {
          const subscriptionValue: SubscriptionValue = {
            value: {
              eventType,
              payload,
              symbols,
            },
            options: {
              connectorType: connector.connectorType,
              marketType: market.marketType,
              key: this.options.key,
              updateMoment: Date.now(),
            },
          };

          this.logger.log(
            `✅ Emitting DETECTOR_EVENT (${eventType}) for symbol=${symbol.name}, connector=${connector.connectorType}, market=${market.marketType}`,
          );

          this.client.emit(SubscriptionType.DETECTOR_EVENT, subscriptionValue);
        }
      }
    }
  }
}
