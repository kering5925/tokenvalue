import { getSql, ensureSchema } from "./db.js";
import { assessCRCLB } from "./strategy.js";
import { assessTurningPoint, recordObservation, TURNING_POINT_SOURCE } from "./observations.js";

const ACTIVE_SYMBOL = "CRCLBUSDT";
const STRATEGY = "crclb-underlying-v2";
const BINANCE_URL = "https://data-api.binance.vision/api/v3";
const NASDAQ_URL = "https://api.nasdaq.com/api/quote/CRCL/chart?assetclass=stocks";
const SIDE_FEE_RATE = 0.0025;
const RISK_PER_TRADE = 0.0035;
const MAX_POSITION_FRACTION = 0.20;
const MIN_STOP_DISTANCE = 0.012;
const MAX_STOP_DISTANCE = 0.04;
const REWARD_MULTIPLE = 1.8;
const MAX_HOLD_MS = 90 * 60 * 1_000;

async function klines(symbol, interval, limit) {
  const response = await fetch(`${BINANCE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Binance ${symbol} ${interval}: ${response.status}`);
  const now = Date.now();
  return (await response.json()).filter((row) => Number(row[6]) < now).map((row) => ({
    closeTime: Number(row[6]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

function easternParts(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function regularSession(timestamp) {
  const parts = easternParts(timestamp);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return !["Sat", "Sun"].includes(parts.weekday) && minutes >= 570 && minutes < 960;
}

function dateKey(timestamp) {
  const parts = easternParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function emaLast(values, period) {
  if (!values.length) return 0;
  const multiplier = 2 / (period + 1);
  return values.slice(1).reduce((value, next) => next * multiplier + value * (1 - multiplier), values[0]);
}

export async function crclSnapshot(now = Date.now()) {
  const response = await fetch(NASDAQ_URL, {
    headers: {
      accept: "application/json,text/plain,*/*",
      origin: "https://www.nasdaq.com",
      referer: "https://www.nasdaq.com/",
      "user-agent": "Mozilla/5.0 (compatible; tokenvalue-paper-trader/2.0)",
      "cache-control": "no-cache",
    },
  });
  if (!response.ok) throw new Error(`Nasdaq CRCL chart: ${response.status}`);
  const payload = await response.json();
  const today = dateKey(now);
  const points = (payload.data?.chart || [])
    .filter((point) => point.x && Number.isFinite(Number(point.y)))
    .map((point) => ({ timestamp: Number(point.x), price: Number(point.y) }))
    .filter((point) => dateKey(point.timestamp) === today && regularSession(point.timestamp));
  const latest = points.at(-1);
  return {
    marketOpen: regularSession(now),
    fresh: Boolean(latest && now - latest.timestamp <= 10 * 60 * 1_000 && now >= latest.timestamp),
    price: latest?.price ?? null,
    sessionOpen: points.at(0)?.price ?? null,
    ema20: points.length ? emaLast(points.slice(-100).map((point) => point.price), 20) : null,
    timestamp: latest?.timestamp ?? null,
  };
}

async function marketSnapshot() {
  const [fiveMinute, fifteenMinute, hourly, underlying] = await Promise.all([
    klines(ACTIVE_SYMBOL, "5m", 200),
    klines(ACTIVE_SYMBOL, "15m", 300),
    klines(ACTIVE_SYMBOL, "1h", 200),
    crclSnapshot().catch((error) => {
      console.warn(`CRCL quote unavailable: ${error.message}`);
      return { marketOpen: regularSession(Date.now()), fresh: false, price: null };
    }),
  ]);
  return {
    assessment: assessCRCLB(fiveMinute, fifteenMinute, hourly, underlying),
    price: fiveMinute.at(-1).close,
    underlying,
    fifteenMinute,
  };
}

async function accountEquity() {
  const sql = getSql();
  const [account] = await sql`SELECT * FROM account WHERE id = 1`;
  const [{ value }] = await sql`SELECT COALESCE(SUM(quantity * last_price), 0)::float8 AS value FROM positions`;
  return { account, equity: account.cash_usdt + value };
}

async function openPosition(price, assessment) {
  const sql = getSql();
  const { account, equity } = await accountEquity();
  const stopDistance = Math.min(MAX_STOP_DISTANCE, Math.max(MIN_STOP_DISTANCE, assessment.atrPercent * 1.5));
  const tokenOnly = assessment.reason === "token-only-entry";
  const riskNotional = equity * RISK_PER_TRADE * (tokenOnly ? 0.5 : 1) / stopDistance;
  const notional = Math.min(riskNotional, equity * (tokenOnly ? 0.10 : MAX_POSITION_FRACTION),
    account.cash_usdt / (1 + SIDE_FEE_RATE));
  if (notional < 10) return false;
  const quantity = notional / price;
  const fee = notional * SIDE_FEE_RATE;
  const now = new Date();
  await sql.transaction([
    sql`UPDATE account SET cash_usdt = cash_usdt - ${notional + fee}, updated_at = ${now} WHERE id = 1`,
    sql`INSERT INTO positions
      (symbol, quantity, entry_price, entry_fee, stop_price, target_price, last_price, opened_at, strategy)
      VALUES (${ACTIVE_SYMBOL}, ${quantity}, ${price}, ${fee}, ${price * (1 - stopDistance)},
        ${price * (1 + stopDistance * REWARD_MULTIPLE)}, ${price}, ${now}, ${STRATEGY})`,
    sql`INSERT INTO trades (symbol, side, price, quantity, fee, realized_pnl, reason, created_at, strategy)
      VALUES (${ACTIVE_SYMBOL}, 'BUY', ${price}, ${quantity}, ${fee}, NULL,
        ${tokenOnly ? "CRCLB-only off-hours breakout" : `confirmed CRCL trend; premium ${assessment.premium?.toFixed(4)}`}, ${now}, ${STRATEGY})`,
  ]);
  return true;
}

async function closePosition(position, price, reason) {
  const sql = getSql();
  const proceeds = position.quantity * price;
  const fee = proceeds * SIDE_FEE_RATE;
  const pnl = proceeds - fee - position.quantity * position.entry_price - position.entry_fee;
  const now = new Date();
  await sql.transaction([
    sql`UPDATE account SET cash_usdt = cash_usdt + ${proceeds - fee}, updated_at = ${now} WHERE id = 1`,
    sql`DELETE FROM positions WHERE symbol = ${position.symbol}`,
    sql`INSERT INTO trades (symbol, side, price, quantity, fee, realized_pnl, reason, created_at, strategy)
      VALUES (${position.symbol}, 'SELL', ${price}, ${position.quantity}, ${fee}, ${pnl}, ${reason}, ${now},
        ${position.strategy || "legacy"})`,
  ]);
}

async function entryRiskAllowed(equity) {
  const sql = getSql();
  const [{ pnl }] = await sql`SELECT COALESCE(SUM(realized_pnl), 0)::float8 AS pnl FROM trades
    WHERE realized_pnl IS NOT NULL AND created_at >= NOW() - INTERVAL '24 hours'`;
  const recent = await sql`SELECT realized_pnl FROM trades
    WHERE side = 'SELL' AND realized_pnl IS NOT NULL AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY id DESC LIMIT 3`;
  return pnl > -equity * 0.01 && !(recent.length === 3 && recent.every((trade) => trade.realized_pnl < 0));
}

async function retireLegacyPositions() {
  const sql = getSql();
  const [run] = await sql`SELECT * FROM strategy_runs WHERE strategy = ${STRATEGY}`;
  if (run) return run;
  const positions = await sql`SELECT * FROM positions ORDER BY symbol`;
  for (const position of positions) {
    const candles = await klines(position.symbol, "5m", 2);
    await closePosition(position, candles.at(-1).close, "strategy-retired-v1");
  }
  const { equity } = await accountEquity();
  const now = new Date();
  await sql`INSERT INTO strategy_runs (strategy, started_at, starting_equity)
    VALUES (${STRATEGY}, ${now}, ${equity}) ON CONFLICT (strategy) DO NOTHING`;
  return { strategy: STRATEGY, started_at: now, starting_equity: equity };
}

async function runCRCLB() {
  const sql = getSql();
  const { assessment, price, underlying, fifteenMinute } = await marketSnapshot();
  let [position] = await sql`SELECT * FROM positions WHERE symbol = ${ACTIVE_SYMBOL}`;
  let action = "none";
  if (position) {
    await sql`UPDATE positions SET last_price = ${price} WHERE symbol = ${ACTIVE_SYMBOL}`;
    const heldTooLong = Date.now() - new Date(position.opened_at).getTime() >= MAX_HOLD_MS;
    if (price <= position.stop_price) {
      await closePosition(position, price, "atr-stop-loss");
      position = undefined;
      action = "stop-loss";
    } else if (price >= position.target_price) {
      await closePosition(position, price, "risk-reward-take-profit");
      position = undefined;
      action = "take-profit";
    } else if (assessment.releasedSignal === "sell") {
      await closePosition(position, price, assessment.reason);
      position = undefined;
      action = "sell";
    } else if (heldTooLong && price <= position.entry_price) {
      await closePosition(position, price, "time-stop");
      position = undefined;
      action = "time-stop";
    }
  }

  const [state] = await sql`SELECT * FROM signal_state WHERE symbol = ${ACTIVE_SYMBOL}`;
  const isNewCandle = !state || Number(state.last_candle_time) !== assessment.closeTime;
  const isTransition = !state || state.last_raw_signal !== assessment.rawSignal;
  if (action === "none" && isNewCandle && isTransition && assessment.releasedSignal === "buy" && !position) {
    const { equity } = await accountEquity();
    if (await entryRiskAllowed(equity) && await openPosition(price, assessment)) action = "buy";
  }

  const now = new Date();
  await sql`INSERT INTO signal_state
    (symbol, last_candle_time, last_raw_signal, score, released_signal, sample_count, win_rate,
      average_net_return, reason, premium, atr_percent, updated_at)
    VALUES (${ACTIVE_SYMBOL}, ${assessment.closeTime || 0}, ${assessment.rawSignal}, ${assessment.score},
      ${assessment.releasedSignal}, 0, NULL, NULL, ${assessment.reason}, ${assessment.premium},
      ${assessment.atrPercent}, ${now})
    ON CONFLICT (symbol) DO UPDATE SET
      last_candle_time = EXCLUDED.last_candle_time, last_raw_signal = EXCLUDED.last_raw_signal,
      score = EXCLUDED.score, released_signal = EXCLUDED.released_signal, sample_count = 0,
      win_rate = NULL, average_net_return = NULL, reason = EXCLUDED.reason, premium = EXCLUDED.premium,
      atr_percent = EXCLUDED.atr_percent, updated_at = EXCLUDED.updated_at`;
  await recordObservation(sql, STRATEGY, ACTIVE_SYMBOL, fifteenMinute, {
    signal: assessment.rawSignal,
    score: assessment.score,
    reason: assessment.reason,
    closeTime: assessment.closeTime,
    close: assessment.close,
  });
  return { symbol: ACTIVE_SYMBOL, price, action, underlying, ...assessment };
}

async function recordTurningPoints() {
  const sql = getSql();
  const results = {};
  for (const symbol of ["ETHUSDT", "CRCLBUSDT"]) {
    const candles = await klines(symbol, "15m", 200);
    const assessment = assessTurningPoint(symbol, candles);
    await recordObservation(sql, TURNING_POINT_SOURCE, symbol, candles, assessment);
    results[symbol] = assessment.signal;
  }
  return results;
}

export async function runCycle() {
  await ensureSchema();
  const run = await retireLegacyPositions();
  const result = await runCRCLB();
  const turningPoints = await recordTurningPoints();
  return { strategy: STRATEGY, run, results: [result], turningPoints };
}

export async function getStatus() {
  await ensureSchema();
  const sql = getSql();
  const [account] = await sql`SELECT * FROM account WHERE id = 1`;
  const positions = await sql`SELECT * FROM positions ORDER BY symbol`;
  const signals = await sql`SELECT * FROM signal_state ORDER BY symbol`;
  const trades = await sql`SELECT * FROM trades ORDER BY id DESC LIMIT 50`;
  const [run] = await sql`SELECT * FROM strategy_runs WHERE strategy = ${STRATEGY}`;
  const equity = account.cash_usdt + positions.reduce((sum, position) => sum + position.quantity * position.last_price, 0);
  return {
    strategy: run ? {
      ...run,
      equity_usdt: equity,
      return_percent: (equity / run.starting_equity - 1) * 100,
    } : { strategy: STRATEGY, status: "pending-first-cycle" },
    account: { ...account, equity_usdt: equity, return_percent: (equity / account.initial_usdt - 1) * 100 },
    positions,
    signals,
    trades,
  };
}
