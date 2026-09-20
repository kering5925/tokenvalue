# Vercel cloud paper trader

Vercel + Neon Postgres paper-trading runner. It starts with 10,000 USDT, runs once per minute, trades CRCLB spot-long only, and charges 0.25% on entry and exit. Entries require a fresh CRCL quote during the NYSE regular session, aligned CRCL/CRCLB trends, volume confirmation, and a bounded CRCLB premium. Position size risks 0.35% of equity with an ATR-based stop and is capped at 20% of equity.

Outside the NYSE regular session the runner manages existing stops but cannot open a position. A 1% rolling daily loss guard and a three-loss guard block new entries. The legacy ETH + CRCLB signal strategy is retired; its positions are closed on the first v2 cycle and its history remains in the database.

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
