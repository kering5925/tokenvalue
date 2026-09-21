# ETH & CRCLB Price Widget

A native macOS 14+ menu bar app, floating desktop card, and WidgetKit widget showing the USD prices of:

- ETH (Ethereum)
- CRCLB (Circle Internet Group bStocks tokenized stock on BNB Smart Chain)

Prices come from Binance's public market-data API and don't require an API key.

## Run without Xcode (menu bar + floating card)

The installed Swift Command Line Tools are sufficient:

```bash
chmod +x build-app.sh
./build-app.sh
open "build/ETH & CRCLB.app"
```

The generated app is ad-hoc signed for personal use on this Mac. It doesn't include the separate system WidgetKit extension.

## Run with full Xcode (includes WidgetKit extension)

1. Install the full version of Xcode 15 or newer.
2. Install XcodeGen if needed: `brew install xcodegen`.
3. In this directory, run `xcodegen generate`.
4. Open `ETHPriceWidget.xcodeproj` and select your Development Team for both targets.
5. Run the `ETHPriceWidget` scheme.
6. Add “ETH & CRCLB” from the macOS widget gallery.

The menu bar and floating card refresh every 60 seconds while the app is running. The card is click-through by default, so the mouse operates the window underneath it. Choose **移动悬浮卡片** from the menu bar before dragging it; lock it again when finished. Its position is restored at next launch. Screenshot shortcuts ⇧⌘3/4/5 temporarily hide the card and restore it after capture.

The app shows ETH prices but no longer generates ETH trading alerts. CRCLB alerts and the simulated position state come from the cloud v2 strategy. During regular NYSE trading, entries require live CRCL confirmation; outside regular hours, stricter CRCLB-only trend and volume rules may trigger simulated trades at reduced size. Stale or unreachable cloud data is shown as unavailable. Alerts are research-only and do not place real trades.

Separately, the cloud runner watches closed 15-minute Binance candles for early bottom/top observations on both ETH and CRCLB. A signal requires a test of the recent low/high, a strong rejection close, improving/weakening RSI, and volume at least 1.2× its recent median. The floating card and menu bar read the same cloud result; each new candle can produce at most one macOS notification if notifications are allowed and the desktop app is running. These are observations, not confirmed reversals or automatic trades. The cloud stores each assessment and later 30/60/90-minute close-to-close returns for evaluation.

The app runs as an accessory (no Dock icon). Choose **退出** from its menu bar menu to stop it. The separate WidgetKit widget remains system-scheduled and can't guarantee one-minute refreshes.

## Data source

The app fetches both Binance spot pairs in one request:

`https://data-api.binance.vision/api/v3/ticker/price?symbols=["ETHUSDT","CRCLBUSDT"]`
