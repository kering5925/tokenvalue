import test from "node:test";
import assert from "node:assert/strict";
import { assessCRCLB, assessCRCLBShadow } from "../src/strategy.js";

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
      takerBuyRatio: 0.6,
    };
  });
}

function fallingCandles(length, minutes, start = 150, step = 0.25) {
  return Array.from({ length }, (_, index) => {
    const close = start - index * step;
    return {
      closeTime: index * minutes * 60_000,
      open: close + 0.15,
      high: close + 0.45,
      low: close - 0.45,
      close,
      volume: 100,
      takerBuyRatio: 0.4,
    };
  });
}

function shadowBottomSetup(regime = "risk") {
  const fifteen = candles(100, 15, 120);
  for (let offset = 22; offset >= 3; offset--) {
    const candle = fifteen.at(-offset);
    const close = 112 - (22 - offset) * 0.55;
    Object.assign(candle, {
      open: close + 0.2, high: close + 0.4, low: close - 0.4, close,
      volume: 100, takerBuyRatio: 0.4,
    });
  }
  Object.assign(fifteen.at(-3), {
    open: 101.3, high: 101.5, low: 100.0, close: 100.5, volume: 100, takerBuyRatio: 0.4,
  });
  Object.assign(fifteen.at(-2), {
    open: 100.4, high: 103.5, low: 99.5, close: 102.8, volume: 200, takerBuyRatio: 0.62,
  });
  Object.assign(fifteen.at(-1), {
    open: 103.8, high: 113.2, low: 103.7, close: 113.0, volume: 120, takerBuyRatio: 0.68,
  });
  const rising = regime === "trend";
  return {
    fifteen,
    fourHour: rising ? candles(100, 240) : fallingCandles(100, 240),
    btcFourHour: rising ? candles(100, 240, 60_000) : fallingCandles(100, 240, 70_000, 100),
    ethFourHour: rising ? candles(100, 240, 2_000) : fallingCandles(100, 240, 3_000, 5),
    underlying: { marketOpen: false, extendedOpen: false, referenceFresh: false, referencePrice: 113.2 },
  };
}

function confirmedPullback(series) {
  const previous = series.at(-2);
  const latest = series.at(-1);
  Object.assign(previous, { open: 123.0, high: 123.2, low: 122.1, close: 122.9 });
  Object.assign(latest, { open: 123.1, high: 123.9, low: 123.0, close: 123.6, volume: 1_000 });
}

test("buys a confirmed off-hours pullback instead of the first breakout", () => {
  const five = candles(200, 5);
  const fifteen = candles(100, 15);
  const hourly = candles(100, 60);
  confirmedPullback(fifteen);
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

test("rejects a late breakout far above the 15-minute mean", () => {
  const fifteen = candles(100, 15);
  fifteen.at(-1).volume = 1_000;
  fifteen.at(-1).close = fifteen.at(-1).high + 1;
  fifteen.at(-1).high = fifteen.at(-1).close + 0.3;
  const result = assessCRCLB(candles(200, 5), fifteen, candles(100, 60), {
    marketOpen: false, fresh: false, price: null,
  });
  assert.equal(result.releasedSignal, "neutral");
  assert.equal(result.reason, "overextended");
});

test("does not buy a weak off-hours breakout", () => {
  const fifteen = candles(100, 15);
  fifteen.at(-1).volume = 1_000;
  const result = assessCRCLB(candles(200, 5), fifteen, candles(100, 60), {
    marketOpen: false, fresh: false, price: null,
  });
  assert.equal(result.releasedSignal, "neutral");
});

test("warns before an off-hours CRCLB trend break is confirmed", () => {
  const fifteen = candles(100, 15);
  const hourly = candles(100, 60);
  fifteen.at(-1).close -= 8;
  hourly.at(-1).close -= 20;
  const result = assessCRCLB(candles(200, 5), fifteen, hourly, {
    marketOpen: false, fresh: false, price: null,
  });
  assert.equal(result.releasedSignal, "risk");
  assert.equal(result.reason, "trend-risk");
});

test("keeps a persistent, falling, high-volume structure break as risk, not a panic sell", () => {
  const fifteen = candles(100, 15);
  const hourly = candles(100, 60);
  for (let offset = 12; offset >= 1; offset--) {
    const candle = fifteen.at(-offset);
    const close = 126 - (13 - offset) * 0.8;
    Object.assign(candle, { open: close + 0.2, high: close + 0.35, low: close - 0.35, close });
  }
  Object.assign(fifteen.at(-1), {
    open: 117.4, high: 117.5, low: 115.6, close: 115.8, volume: 1_000,
  });
  for (let offset = 12; offset >= 1; offset--) {
    const candle = hourly.at(-offset);
    const close = 124 - (13 - offset) * 1.2;
    Object.assign(candle, { open: close + 0.2, high: close + 0.4, low: close - 0.4, close });
  }
  const result = assessCRCLB(candles(200, 5), fifteen, hourly, {
    marketOpen: false, fresh: false, price: null,
  });
  assert.equal(result.releasedSignal, "risk");
  assert.equal(result.reason, "trend-risk");
});

test("releases a confirmed entry only when CRCL and CRCLB agree", () => {
  const five = candles(200, 5);
  const fifteen = candles(100, 15);
  const hourly = candles(100, 60);
  confirmedPullback(fifteen);
  const latest = fifteen.at(-1);
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

test("V5.1 shadow buys a confirmed left-side reversal during broad risk", () => {
  const setup = shadowBottomSetup("risk");
  const result = assessCRCLBShadow(setup.fifteen, setup.fourHour, setup.btcFourHour,
    setup.ethFourHour, setup.underlying);
  assert.equal(result.releasedSignal, "buy");
  assert.equal(result.reason, "v5.1-left-reversal");
  assert.equal(result.context.regime, "risk");
  assert.equal(result.context.turningSignal, "bottom");
  assert.equal(result.context.reversalEntry, true);
  assert.equal(result.context.directionalVolume, true);
  assert.equal(result.context.fairAnchor, true);
});

test("V5.1 shadow buys a confirmed trend pullback", () => {
  const setup = shadowBottomSetup("trend");
  const result = assessCRCLBShadow(setup.fifteen, setup.fourHour, setup.btcFourHour,
    setup.ethFourHour, setup.underlying);
  assert.equal(result.releasedSignal, "buy");
  assert.equal(result.reason, "v5.1-trend-pullback");
  assert.equal(result.context.regime, "trend");
  assert.equal(result.context.trendEntry, true);
});

test("V5.1 shadow rejects a bottom dominated by sellers", () => {
  const setup = shadowBottomSetup("risk");
  Object.assign(setup.fifteen.at(-1), { volume: 1_000, takerBuyRatio: 0.4 });
  const result = assessCRCLBShadow(setup.fifteen, setup.fourHour, setup.btcFourHour,
    setup.ethFourHour, setup.underlying);
  assert.notEqual(result.releasedSignal, "buy");
  assert.equal(result.context.directionalVolume, false);
});
