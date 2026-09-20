import { neon } from "@neondatabase/serverless";

let client;

export function getSql() {
  if (!client) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
    client = neon(process.env.DATABASE_URL);
  }
  return client;
}

export async function ensureSchema() {
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
  await sql`CREATE TABLE IF NOT EXISTS strategy_runs (
    strategy text PRIMARY KEY,
    started_at timestamptz NOT NULL,
    starting_equity double precision NOT NULL
  )`;
  await sql`INSERT INTO account (id, cash_usdt, initial_usdt, updated_at)
    VALUES (1, 10000, 10000, NOW()) ON CONFLICT (id) DO NOTHING`;
}
