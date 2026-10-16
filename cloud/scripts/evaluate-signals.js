import { assessCRCLB } from "../src/strategy.js";
import { assessTurningPoint } from "../src/observations.js";

const START = Date.parse("2026-06-11T00:00:00Z");
const HORIZON_BARS = Number(process.env.HORIZON_BARS || 6);
const FEE_ROUND_TRIP = 0.005;
const periods = [
  ["2026-06-11", "2026-09-01"],
  ["2026-09-01", "2026-09-21"],
  ["2026-09-21", "2026-10-01"],
];

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

const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function regularSession(timestamp) {
  const parts = Object.fromEntries(eastern.formatToParts(new Date(timestamp))
    .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return !["Sat", "Sun"].includes(parts.weekday) && minute >= 570 && minute < 960;
}

function summarize(rows, kind) {
  let lastTime = -Infinity;
  const returns = [];
  for (const row of rows) {
    if (!row[kind] || row.time - lastTime < HORIZON_BARS * 15 * 60_000) continue;
    lastTime = row.time;
    const predictsDown = kind === "top" || kind === "risk" || kind === "sell";
    const movement = predictsDown ? row.close / row.future - 1 : row.future / row.close - 1;
    returns.push(movement - (kind === "buy" ? FEE_ROUND_TRIP : 0));
  }
  return {
    samples: returns.length,
    hitRate: returns.length ? returns.filter((value) => value > 0).length / returns.length : null,
    averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
  };
}

const [fifteen, hourly] = await Promise.all([candles("15m"), candles("1h")]);
const evaluated = [];
let hourIndex = -1;
let previousSignal = "neutral";
for (let index = 200; index < fifteen.length - HORIZON_BARS; index++) {
  const current = fifteen[index];
  while (hourIndex + 1 < hourly.length && hourly[hourIndex + 1].closeTime <= current.closeTime) hourIndex++;
  if (hourIndex < 50) continue;
  const recent15m = fifteen.slice(Math.max(0, index - 299), index + 1);
  const recent1h = hourly.slice(Math.max(0, hourIndex - 199), hourIndex + 1);
  const marketOpen = regularSession(current.closeTime);
  const assessment = assessCRCLB(Array(20), recent15m, recent1h,
    { marketOpen, fresh: false, price: null });
  const point = assessTurningPoint("CRCLBUSDT", recent15m, current.closeTime + 1);
  evaluated.push({
    time: current.closeTime, close: current.close, future: fifteen[index + HORIZON_BARS].close,
    buy: !marketOpen && assessment.rawSignal === "buy" && previousSignal !== "buy",
    risk: assessment.rawSignal === "risk" && previousSignal !== "risk",
    sell: assessment.rawSignal === "sell" && previousSignal !== "sell",
    bottom: point.signal === "bottom", top: point.signal === "top",
  });
  previousSignal = assessment.rawSignal;
}

console.log(JSON.stringify({
  source: "Binance CRCLBUSDT closed candles",
  measure: `${HORIZON_BARS * 15}-minute forward close-to-close; buy subtracts 0.5% round-trip fees; no slippage or stop simulation`,
  latestCandle: new Date(fifteen.at(-1).closeTime).toISOString(),
  periods: periods.map(([start, end]) => {
    const rows = evaluated.filter((row) => row.time >= Date.parse(start) && row.time < Date.parse(end));
    return { start, end, buy: summarize(rows, "buy"), risk: summarize(rows, "risk"),
      sell: summarize(rows, "sell"), bottom: summarize(rows, "bottom"), top: summarize(rows, "top") };
  }),
}, null, 2));
