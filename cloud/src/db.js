import { neon } from "@neondatabase/serverless";

let client;
let schemaPromise;

export function getSql() {
  if (!client) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
    client = neon(process.env.DATABASE_URL);
  }
  return client;
}

export function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = prepareSchema().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

async function prepareSchema() {
  const sql = getSql();
  await sql`CREATE TABLE IF NOT EXISTS account (
    id integer PRIMARY KEY CHECK (id = 1),
    cash_usdt double precision NOT NULL,
    initial_usdt double precision NOT NULL,
    updated_at timestamptz NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS positions (
    symbol text PRIMARY KEY,
    quantity double precision NOT NULL,
    entry_price double precision NOT NULL,
    entry_fee double precision NOT NULL,
    stop_price double precision NOT NULL,
    target_price double precision NOT NULL,
    last_price double precision NOT NULL,
    opened_at timestamptz NOT NULL,
    strategy text NOT NULL DEFAULT 'legacy'
  )`;
  await sql`CREATE TABLE IF NOT EXISTS trades (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    symbol text NOT NULL,
    side text NOT NULL,
    price double precision NOT NULL,
    quantity double precision NOT NULL,
    fee double precision NOT NULL,
    realized_pnl double precision,
    reason text NOT NULL,
    created_at timestamptz NOT NULL,
    strategy text NOT NULL DEFAULT 'legacy'
  )`;
  await sql`CREATE TABLE IF NOT EXISTS signal_state (
    symbol text PRIMARY KEY,
    last_candle_time bigint NOT NULL,
    last_raw_signal text NOT NULL,
    score integer NOT NULL,
    released_signal text NOT NULL,
    sample_count integer NOT NULL,
    win_rate double precision NOT NULL,
    average_net_return double precision NOT NULL,
    reason text NOT NULL DEFAULT '',
    premium double precision,
    atr_percent double precision NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL
  )`;
  await sql`ALTER TABLE positions ADD COLUMN IF NOT EXISTS strategy text NOT NULL DEFAULT 'legacy'`;
  await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy text NOT NULL DEFAULT 'legacy'`;
  await sql`ALTER TABLE signal_state ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE signal_state ADD COLUMN IF NOT EXISTS premium double precision`;
  await sql`ALTER TABLE signal_state ADD COLUMN IF NOT EXISTS atr_percent double precision NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE signal_state ALTER COLUMN win_rate DROP NOT NULL`;
  await sql`ALTER TABLE signal_state ALTER COLUMN average_net_return DROP NOT NULL`;
  await sql`CREATE TABLE IF NOT EXISTS strategy_runs (
    strategy text PRIMARY KEY,
    started_at timestamptz NOT NULL,
    starting_equity double precision NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS signal_observations (
    source text NOT NULL,
    symbol text NOT NULL,
    candle_time bigint NOT NULL,
    close_price double precision NOT NULL,
    signal text NOT NULL,
    score integer,
    reason text NOT NULL,
    return_30m double precision,
    return_60m double precision,
    return_90m double precision,
    return_180m double precision,
    return_360m double precision,
    return_720m double precision,
    return_1440m double precision,
    mfe_90m double precision,
    mae_90m double precision,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_at timestamptz NOT NULL DEFAULT NOW(),
    checked_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, symbol, candle_time)
  )`;
  await sql`ALTER TABLE signal_observations ADD COLUMN IF NOT EXISTS return_180m double precision`;
  await sql`ALTER TABLE signal_observations ADD COLUMN IF NOT EXISTS return_360m double precision`;
  await sql`ALTER TABLE signal_observations ADD COLUMN IF NOT EXISTS return_720m double precision`;
  await sql`ALTER TABLE signal_observations ADD COLUMN IF NOT EXISTS return_1440m double precision`;
  await sql`ALTER TABLE signal_observations ADD COLUMN IF NOT EXISTS mfe_90m double precision`;
  await sql`ALTER TABLE signal_observations ADD COLUMN IF NOT EXISTS mae_90m double precision`;
  await sql`ALTER TABLE signal_observations ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb`;
  await sql`UPDATE signal_state SET win_rate = NULL, average_net_return = NULL
    WHERE sample_count = 0 AND (win_rate IS NOT NULL OR average_net_return IS NOT NULL)`;
  await sql`INSERT INTO account (id, cash_usdt, initial_usdt, updated_at)
    VALUES (1, 10000, 10000, NOW()) ON CONFLICT (id) DO NOTHING`;
  await sql`CREATE TABLE IF NOT EXISTS shadow_strategy_state (
    strategy text NOT NULL,
    symbol text NOT NULL,
    last_candle_time bigint NOT NULL,
    last_signal text NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (strategy, symbol)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS shadow_positions (
    strategy text NOT NULL,
    symbol text NOT NULL,
    original_quantity double precision NOT NULL,
    quantity double precision NOT NULL,
    entry_price double precision NOT NULL,
    entry_fee double precision NOT NULL,
    stop_price double precision NOT NULL,
    highest_price double precision NOT NULL,
    last_price double precision NOT NULL,
    target_taken boolean NOT NULL DEFAULT false,
    top_reduced boolean NOT NULL DEFAULT false,
    opened_at timestamptz NOT NULL,
    entry_candle_time bigint NOT NULL,
    entry_reason text NOT NULL,
    PRIMARY KEY (strategy, symbol)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS shadow_trades (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategy text NOT NULL,
    symbol text NOT NULL,
    side text NOT NULL,
    price double precision NOT NULL,
    quantity double precision NOT NULL,
    fee double precision NOT NULL,
    realized_pnl double precision,
    reason text NOT NULL,
    candle_time bigint NOT NULL,
    created_at timestamptz NOT NULL
  )`;
}
