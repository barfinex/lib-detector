# @barfinex/detector

**`@barfinex/detector`** is a core microservice package in the [Barfinex](https://barfinex.com) ecosystem.  
It provides the **event-driven detection layer** that powers trading strategies, order execution logic, and signal generation across Barfinex services.

This package implements **modular detectors** that listen to real-time market data, analyze conditions, and emit signals for further processing by advisors, order managers, or plugins.

---

## 🚀 Purpose

The `@barfinex/detector` package is designed to:

- 📡 **Process real-time data** — candles, trades, orderbooks, and account events.
- ⚡ **Generate signals** — based on custom rules, indicators, or plugins.
- 🔌 **Integrate with plugins** — extend detection with runtime-loaded strategies (via `@barfinex/plugin-driver`).
- 🛠 **Support modular instances** — each detector runs with its own configuration and lifecycle.
- 🔄 **Bridge with ecosystem** — interacts with `@barfinex/orders`, `@barfinex/connectors`, and `@barfinex/utils`.

---

## 📦 Installation

To install the package, use npm or yarn:

```sh
npm install @barfinex/detector
```

or

```sh
yarn add @barfinex/detector
```

---

## 📘 Example Usage

```ts
import { DetectorService } from '@barfinex/detector';
import { VolumeFollowConfig } from '@barfinex/detector/instances/volume-follow';

// Initialize detector with configuration
const detector = new DetectorService({
  name: 'volume-follow-btc',
  options: VolumeFollowConfig,
});

// Start detection loop
detector.onStart();
```

---

## 📚 What's Included

The `@barfinex/detector` package includes:

- **DetectorService** — core service orchestrating plugins and detection lifecycle.
- **Instances** — ready-to-use strategies (e.g., `volume-follow`, `follow-trend`, `empty`, `template`).
- **Plugins Integration** — via `@barfinex/plugin-driver` and domain-specific plugins like:
  - `@barfinex/detector-plugin-trade-journal`
  - `@barfinex/detector-plugin-orderflow-trade-analytics`
- **Common Utils** — validation, error handling, configuration helpers.
- **Events** — hooks for lifecycle: `onInit`, `onStart`, `onAccountUpdate`, etc.

---

## 🤝 Contributing

We welcome contributions to improve the detection framework:

- 🛠 Add new detection strategies or instances.
- 🔌 Write plugins to extend detector capabilities.
- 📈 Share optimizations for handling high-frequency data.

Join the Barfinex developer community: [t.me/barfinex](https://t.me/barfinex)

---

## 📜 License

This repository is licensed under the [Apache License 2.0](LICENSE) with additional restrictions.

### Key Terms:
1. **Attribution**: Proper credit must be given to the original author, Barfin Network Limited, with a link to the official website: [https://barfin.network/](https://barfin.network/).
2. **Non-Commercial Use**: The use of this codebase for commercial purposes is prohibited without explicit written permission.
3. **Display Requirements**: For non-commercial use, the following must be displayed:
   - The name "Barfin Network Limited".
   - The official logo.
   - A working link to [https://barfinex.com/](https://barfinex.com/).
