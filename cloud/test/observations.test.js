import test from "node:test";
import assert from "node:assert/strict";
import { assessTurningPoint, outcomeReturns } from "../src/observations.js";

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

test("matches the desktop bottom and top turning-point conditions", () => {
  const down = candles(true);
  down[39] = { ...down[39], open: 84, high: 86.2, low: 83.7, close: 86, volume: 200 };
  const up = candles(false);
  up[39] = { ...up[39], open: 116, high: 116.3, low: 113.8, close: 114, volume: 200 };
  const now = up[39].closeTime + 1;
  assert.equal(assessTurningPoint("ETHUSDT", down, now).signal, "bottom");
  assert.equal(assessTurningPoint("CRCLBUSDT", up, now).signal, "top");
  assert.equal(assessTurningPoint("ETHUSDT", candles(true), now).signal, "none");
  assert.equal(assessTurningPoint("ETHUSDT", down, now + 30 * 60_000).signal, "unavailable");
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
