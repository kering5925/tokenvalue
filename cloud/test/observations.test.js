import test from "node:test";
import assert from "node:assert/strict";
import { assessTurningPoint, outcomeMetrics, outcomeReturns } from "../src/observations.js";

function candles(descending) {
  return Array.from({ length: 40 }, (_, index) => {
    const close = descending ? 100 - index * 0.4 : 100 + index * 0.4;
    return {
      closeTime: 1_000_000 + index * 900_000,
      open: close + (descending ? 0.1 : -0.1),
      high: close + 0.3,
      low: close - 0.3,
      close,
      volume: 100,
    };
  });
}

test("confirms bottoms on the following candle and keeps tops immediate", () => {
  const down = candles(true);
  down[39] = { ...down[39], open: 84, high: 86.2, low: 83.7, close: 86, volume: 200 };
  const up = candles(false);
  up[39] = { ...up[39], open: 116, high: 116.3, low: 113.8, close: 114, volume: 200 };
  const now = up[39].closeTime + 900_001;
  assert.equal(assessTurningPoint("ETHUSDT", down, up[39].closeTime + 1).signal, "bottom-watch");
  assert.equal(assessTurningPoint("CRCLBUSDT", up, up[39].closeTime + 1).signal, "top");
  down.push({ ...down[39], closeTime: down[39].closeTime + 900_000,
    open: 86.0, high: 86.6, low: 85.9, close: 86.4, volume: 100 });
  assert.equal(assessTurningPoint("ETHUSDT", down, now).signal, "bottom");
  assert.equal(assessTurningPoint("ETHUSDT", candles(true), now).signal, "none");
  assert.equal(assessTurningPoint("ETHUSDT", down, now + 30 * 60_000).signal, "unavailable");
});

test("does not call a single-candle bounce a confirmed bottom", () => {
  const down = candles(true);
  down[39] = { ...down[39], open: 84, high: 86.2, low: 83.7, close: 86, volume: 200 };
  down.push({ ...down[39], closeTime: down[39].closeTime + 900_000,
    open: 86, high: 86.1, low: 84.5, close: 85, volume: 100 });
  assert.equal(assessTurningPoint("CRCLBUSDT", down, down.at(-1).closeTime + 1).signal, "none");
});

test("settles only horizons with an exact closed 15-minute candle", () => {
  const start = 1_000_000;
  const series = [100, 101, 102, 103, 104].map((close, index) => ({
    closeTime: start + index * 15 * 60_000,
    close,
  }));
  const complete = outcomeReturns(series, start, 100);
  assert.ok(Math.abs(complete[30] - 0.02) < 1e-10);
  assert.ok(Math.abs(complete[60] - 0.04) < 1e-10);
  assert.equal(complete[90], null);
  const missing = outcomeReturns(series.filter((_, index) => index !== 2), start, 100);
  assert.equal(missing[30], null);
  assert.ok(Math.abs(missing[60] - 0.04) < 1e-10);
});

test("records 90-minute favorable and adverse excursion only after the window matures", () => {
  const start = 1_000_000;
  const series = Array.from({ length: 7 }, (_, index) => ({
    closeTime: start + index * 15 * 60_000,
    high: 100 + index,
    low: 100 - index * 0.5,
    close: 100 + index * 0.25,
  }));
  const complete = outcomeMetrics(series, start, 100);
  assert.ok(Math.abs(complete.mfe90m - 0.06) < 1e-10);
  assert.ok(Math.abs(complete.mae90m + 0.03) < 1e-10);
  const pending = outcomeMetrics(series.slice(0, 6), start, 100);
  assert.equal(pending.mfe90m, null);
  assert.equal(pending.mae90m, null);
});

test("retains six, twelve, and twenty-four hour outcome paths", () => {
  const start = 1_000_000;
  const series = Array.from({ length: 97 }, (_, index) => ({
    closeTime: start + index * 15 * 60_000,
    close: 100 + index,
  }));
  const result = outcomeReturns(series, start, 100);
  assert.equal(result[360], 0.24);
  assert.equal(result[720], 0.48);
  assert.equal(result[1440], 0.96);
});
