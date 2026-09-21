import test from "node:test";
import assert from "node:assert/strict";
import { assessCRCLB } from "../src/strategy.js";

function candles(length, minutes, start = 100, volume = 100) {
  return Array.from({ length }, (_, index) => {
    const close = start + index * 0.25;
    return {
      closeTime: index * minutes * 60_000,
      open: close - 0.15,
      high: close + 0.45,
      low: close - 0.45,
      close,
      volume,
    };
  });
}

test("releases a token-only breakout while the underlying market is closed", () => {
  const five = candles(200, 5);
  const fifteen = candles(100, 15);
  const hourly = candles(100, 60);
  fifteen.at(-1).volume = 1_000;
  fifteen.at(-1).close = fifteen.at(-1).high + 1;
  fifteen.at(-1).high = fifteen.at(-1).close + 0.3;
  const result = assessCRCLB(five, fifteen, hourly, {
    marketOpen: false,
    fresh: false,
    price: fifteen.at(-1).close,
    sessionOpen: 100,
    ema20: 110,
  });
  assert.equal(result.releasedSignal, "buy");
  assert.equal(result.reason, "token-only-entry");
  assert.equal(result.score, 100);
});

test("does not buy a weak off-hours breakout", () => {
  const fifteen = candles(100, 15);
  fifteen.at(-1).volume = 1_000;
  const result = assessCRCLB(candles(200, 5), fifteen, candles(100, 60), {
    marketOpen: false, fresh: false, price: null,
  });
  assert.equal(result.releasedSignal, "neutral");
  assert.equal(result.reason, "off-hours-conditions-not-met");
});

test("sells on an off-hours CRCLB trend break", () => {
  const fifteen = candles(100, 15);
  const hourly = candles(100, 60);
  fifteen.at(-1).close -= 8;
  hourly.at(-1).close -= 20;
  const result = assessCRCLB(candles(200, 5), fifteen, hourly, {
    marketOpen: false, fresh: false, price: null,
  });
  assert.equal(result.releasedSignal, "sell");
  assert.equal(result.reason, "token-only-exit");
});

test("releases a confirmed entry only when CRCL and CRCLB agree", () => {
  const five = candles(200, 5);
  const fifteen = candles(100, 15);
  const hourly = candles(100, 60);
  const previous = fifteen.at(-2);
  const latest = fifteen.at(-1);
  previous.close -= 1;
  latest.close = latest.high + 1;
  latest.high = latest.close + 0.3;
  latest.volume = 1_000;
  const result = assessCRCLB(five, fifteen, hourly, {
    marketOpen: true,
    fresh: true,
    price: latest.close + 0.2,
    sessionOpen: latest.close - 2,
    ema20: latest.close - 1,
  });
  assert.equal(result.releasedSignal, "buy");
  assert.equal(result.reason, "confirmed-entry");
});

test("rejects an overheated CRCLB premium", () => {
  const five = candles(200, 5);
  const fifteen = candles(100, 15);
  const hourly = candles(100, 60);
  fifteen.at(-1).volume = 1_000;
  const result = assessCRCLB(five, fifteen, hourly, {
    marketOpen: true,
    fresh: true,
    price: fifteen.at(-1).close * 0.95,
    sessionOpen: 100,
    ema20: 110,
  });
  assert.equal(result.releasedSignal, "neutral");
});
