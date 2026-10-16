# Vercel cloud paper trader

Vercel + Neon Postgres paper-trading runner. It starts with 10,000 USDT, runs once per minute, trades CRCLB spot-long only, and charges 0.25% on entry and exit. Entries require a fresh CRCL quote during the NYSE regular session, aligned CRCL/CRCLB trends, volume confirmation, and a bounded CRCLB premium. Position size risks 0.35% of equity with an ATR-based stop and is capped at 20% of equity.

Outside the NYSE regular session, a CRCLB-only pullback/reclaim can open a half-risk position capped at 10% of equity. Entries are rejected when the price is overextended from the 15-minute EMA or a top warning is active. Trend weakness is exposed as a risk warning. If a position is already above the fee-adjusted break-even price, that warning raises its stop to break-even; losing positions keep their original ATR stop rather than panic-selling after a breakdown. Historical candidate exits are evaluated with `node scripts/evaluate-exit-candidates.js` before they are allowed to trigger a close. A 1% rolling daily loss guard and a three-loss guard block new entries. Strategy v4 starts a separate performance run; earlier trade history remains in the database.

Strategy v5.1 runs in parallel as a shadow strategy and never changes the v4 account balance. It has two entry paths: a left-side reversal can open during range or risk regimes after a confirmed bottom and directional Binance taker-buy volume, while a trend pullback requires a bottom setup, 15-minute EMA reclaim, higher low, and directional volume. Both paths require a bounded CRCLB-to-CRCL reference-price premium and reject structure breaks or confirmed tops. Fifteen-minute volatility is a score input rather than a hard entry gate. The reference anchor uses fresh Nasdaq extended-hours data when available and falls back to the latest official sale or previous close. V5.1 opens a virtual position worth 3% of current v4 equity, takes half off at +1.3%, protects fee-adjusted break-even, reduces one third on a confirmed top, applies a structure/trailing stop, exits stagnant below-EMA positions after six hours, and has a twelve-hour maximum hold. Its positions and fills live in `shadow_positions` and `shadow_trades`; `/api/status` exposes them under `shadow`.

Deployment uses a Vercel Hobby project, a Neon Marketplace database, and Upstash QStash for the one-minute schedule:

```bash
npm install
vercel link
vercel integration add neon
vercel integration add upstash/upstash-qstash
vercel env add CRON_SECRET production
vercel env add STATUS_SECRET production
vercel --prod
```

QStash calls `/api/cron` every minute and forwards `Authorization: Bearer $CRON_SECRET`. Call `/api/status` with `Authorization: Bearer $STATUS_SECRET` for account equity, positions, signals, and the latest 50 trades. No exchange API key or real-money permission is used.

The cron runner records one `signal_observations` row per closed 15-minute candle for v4, the v5.1 shadow strategy, and ETH/CRCLB turning-point assessments. Each row is keyed by source, symbol, and candle time to avoid duplicates. Later cycles fill in 30/60/90/180/360/720/1440-minute close-to-close returns plus 90-minute maximum favorable/adverse excursion from closed Binance candles; these are observational outcomes, not executed-trade P&L. The observation context stores the conditions behind each strategy signal. `/api/signal` exposes the latest v5.1 shadow signal to the desktop app, and `/api/turning-points` returns the latest cloud turning-point assessment. A bottom setup first appears as `bottom-watch` and becomes `bottom` only after the following candle breaks the candidate high; top warnings remain immediate. The historical evaluation script `node scripts/evaluate-signals.js` reports fixed-horizon proxies, not realized strategy P&L.
