const START = Date.parse("2026-06-11T00:00:00Z");
const HORIZONS = [6, 12];

async function candles(interval) {
  const result = [];
  let startTime = START;
  for (;;) {
    const url = new URL("https://data-api.binance.vision/api/v3/klines");
    url.search = new URLSearchParams({ symbol: "CRCLBUSDT", interval,
      startTime: String(startTime), limit: "1000" });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance ${interval}: ${response.status}`);
    const batch = await response.json();
    result.push(...batch.filter((row) => Number(row[6]) < Date.now()).map((row) => ({
      closeTime: Number(row[6]), open: Number(row[1]), high: Number(row[2]),
      low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]),
    })));
    if (batch.length < 1000) return result;
    startTime = Number(batch.at(-1)[6]) + 1;
  }
}

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  return values.slice(1).reduce((rows, value) => {
    rows.push(value * multiplier + rows.at(-1) * (1 - multiplier));
    return rows;
  }, [values[0]]);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rsi(candles, index) {
  let gains = 0;
  let losses = 0;
  for (let cursor = index - 13; cursor <= index; cursor++) {
    const change = candles[cursor].close - candles[cursor - 1].close;
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
}

function summarize(events, start, end, horizon) {
  const rows = events.filter((row) => row.time >= Date.parse(start) && row.time < Date.parse(end));
  const returns = rows.map((row) => row.close / row.future[horizon] - 1);
  return { n: returns.length, hitRate: returns.length
    ? returns.filter((value) => value > 0).length / returns.length : null,
  average: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null };
}

const [fifteen, hourly] = await Promise.all([candles("15m"), candles("1h")]);
const close15 = fifteen.map((candle) => candle.close);
const ema15 = ema(close15, 20);
const close1h = hourly.map((candle) => candle.close);
const ema20h = ema(close1h, 20);
const ema50h = ema(close1h, 50);
const candidates = {
  risk: ({ risk }) => risk,
  firstCross: ({ risk, index }) => risk && fifteen[index - 1].close >= ema15[index - 1],
  twoBelow: ({ risk, index }) => risk && fifteen[index - 1].close < ema15[index - 1] && ema15[index] < ema15[index - 1],
  bearishVolume: ({ risk, index, volumeRatio }) => risk && fifteen[index].close < fifteen[index].open && volumeRatio >= 1.25,
  fallingRsi: ({ risk, index }) => risk && rsi(fifteen, index) < 45 && rsi(fifteen, index) < rsi(fifteen, index - 1),
  firstCrossRsi: ({ risk, index }) => risk && fifteen[index - 1].close >= ema15[index - 1]
    && rsi(fifteen, index) < 50 && rsi(fifteen, index) < rsi(fifteen, index - 1),
  twoBelowRsi: ({ risk, index }) => risk && fifteen[index - 1].close < ema15[index - 1]
    && ema15[index] < ema15[index - 1] && rsi(fifteen, index) < 45,
  lowVolumeBreak: ({ risk, index, volumeRatio }) => risk
    && fifteen[index].close < Math.min(...fifteen.slice(index - 16, index).map((candle) => candle.low))
    && volumeRatio < 1.25,
};

const events = Object.fromEntries(Object.keys(candidates).map((name) => [name, []]));
const active = Object.fromEntries(Object.keys(candidates).map((name) => [name, false]));
let hourIndex = 0;
for (let index = 100; index < fifteen.length - Math.max(...HORIZONS); index++) {
  while (hourIndex + 1 < hourly.length && hourly[hourIndex + 1].closeTime <= fifteen[index].closeTime) hourIndex++;
  if (hourIndex < 50) continue;
  const hourlyTrendUp = ema20h[hourIndex] > ema50h[hourIndex]
    && hourly[hourIndex].close > ema20h[hourIndex];
  const risk = !hourlyTrendUp && fifteen[index].close < ema15[index];
  const volumeBase = median(fifteen.slice(index - 20, index).map((candle) => candle.volume));
  const context = { risk, index, volumeRatio: volumeBase ? fifteen[index].volume / volumeBase : 0 };
  for (const [name, predicate] of Object.entries(candidates)) {
    const signal = predicate(context);
    if (signal && !active[name]) {
      events[name].push({ time: fifteen[index].closeTime, close: fifteen[index].close,
        future: Object.fromEntries(HORIZONS.map((horizon) => [horizon, fifteen[index + horizon].close])) });
    }
    active[name] = signal;
  }
}

const periods = [["2026-06-11", "2026-09-01"], ["2026-09-01", "2026-09-21"],
  ["2026-09-21", "2026-10-01"]];
console.log(JSON.stringify(Object.fromEntries(Object.entries(events).map(([name, rows]) => [name,
  Object.fromEntries(HORIZONS.map((horizon) => [`${horizon * 15}m`, periods.map(([start, end]) => ({
    period: `${start}/${end}`, ...summarize(rows, start, end, horizon),
  }))]))])), null, 2));
