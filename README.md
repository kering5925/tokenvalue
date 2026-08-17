# ETH & CRCLB Price Widget

A native macOS 14+ menu bar app, floating desktop card, and WidgetKit widget showing the USD prices of:

- ETH (Ethereum)
- CRCLB (Circle Internet Group bStocks tokenized stock on BNB Smart Chain)

Prices come from the public DeFiLlama Coins API and don't require an API key.

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

The menu bar and floating card refresh every 60 seconds while the app is running. Drag the floating card from anywhere on its background; its position is restored at next launch. Use the menu bar menu to hide/show it or refresh immediately.

The app runs as an accessory (no Dock icon). Choose **退出** from its menu bar menu to stop it. The separate WidgetKit widget remains system-scheduled and can't guarantee one-minute refreshes.

## Data source

The app fetches both assets in one request:

`https://coins.llama.fi/prices/current/coingecko:ethereum,bsc:0x80f3d493ebce97e343c53d29a137942416b4ffc0`
