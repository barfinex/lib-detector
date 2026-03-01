# @barfinex/detector

**Event-driven detection layer** of the [Barfinex](https://barfinex.com) ecosystem — the analytics engine that consumes market data from the Provider, runs strategies and plugins, and emits signals for Advisor and Inspector.

Detector is the component that turns raw candles, trades, and orderbook updates into **actionable signals** and position requests. It runs as a separate service, connects to the event bus (Redis), and can be extended with plugins (e.g. orderflow analytics, trade journal).

---

## What it does

- **Real-time processing** — subscribes to Provider channels (candles, trades, orderbook, account/orders) and runs detection logic.
- **Modular instances** — multiple detector configs and strategies; each instance has its own lifecycle and plugins.
- **Plugin system** — integrates with `@barfinex/plugin-driver` and plugins like `@barfinex/detector-plugin-orderflow-trade-analytics` and `@barfinex/detector-plugin-trade-journal`.
- **Signals & metrics** — emits signals to the bus, exposes REST for status and metrics, and works with `@barfinex/orders` and `@barfinex/connectors`.

---

## Installation

```sh
npm install @barfinex/detector
```

or

```sh
yarn add @barfinex/detector
```

---

## What's included

| Export | Purpose |
|--------|--------|
| `DetectorModule` / `DetectorCoreModule` | NestJS modules for detector app wiring. |
| `DetectorService` | Core service: lifecycle, plugins, detection loop. |
| `DetectorManagerService` | Manages detector instances and config. |
| `DetectorPluginService` | Plugin registration and execution. |
| `DetectorController` | REST API for detector operations. |
| `DetectorPerformanceMetrics` | Performance metrics. |
| Signal types & helpers | From `./signal`. |

---

## Documentation

- **Detector** — [Installation detector](https://barfinex.com/docs/installation-detector) — Redis channels, config, connecting to Provider, verifying signals.
- **Barfinex overview** — [First Steps](https://barfinex.com/docs/first-steps), [Architecture](https://barfinex.com/docs/architecture), [Glossary](https://barfinex.com/docs/glossary).
- **Provider (data source)** — [Installation provider](https://barfinex.com/docs/installation-provider), [Understanding Provider Logs](https://barfinex.com/docs/installation-provider-logs), [Provider API reference](https://barfinex.com/docs/provider-api).
- **Studio** — [Terminal Configuration](https://barfinex.com/docs/configuration-studio), [Registering Provider in Studio](https://barfinex.com/docs/configuration-studio-provider).
- **APIs & signals** — [Detector API reference](https://barfinex.com/docs/detector-api), [Signals context API](https://barfinex.com/docs/signals-context), [Building with the API](https://barfinex.com/docs/frontend-api).
- **Troubleshooting** — [Typical problems and solutions](https://barfinex.com/docs/troubleshooting).

---

## Contributing

New detection strategies and plugin ideas are welcome. Open an issue or PR. Community: [Telegram](https://t.me/barfinex) · [GitHub](https://github.com/barfinex).

---

## License

Licensed under the [Apache License 2.0](LICENSE) with additional terms. Attribution to **Barfin Network Limited** and a link to [https://barfinex.com](https://barfinex.com) are required. Commercial use requires explicit permission. See [LICENSE](LICENSE) and the [Barfinex site](https://barfinex.com) for details.
