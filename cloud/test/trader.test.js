import test from "node:test";
import assert from "node:assert/strict";
import { feeBreakEvenPrice } from "../src/trader.js";
import { planShadowExit, shadowBreakEvenPrice } from "../src/shadow.js";

test("fee break-even price covers entry and exit fees", () => {
  const entryPrice = 100;
  const quantity = 10;
  const feeRate = 0.0025;
  const exitPrice = feeBreakEvenPrice(entryPrice, feeRate);
  const pnl = quantity * exitPrice * (1 - feeRate) - quantity * entryPrice * (1 + feeRate);
  assert.ok(Math.abs(pnl) < 1e-10);
  assert.equal(exitPrice, 100.50125313283208);
});

function shadowPosition(overrides = {}) {
  return {
    entry_price: 100,
    stop_price: 98.8,
    highest_price: 100,
    target_taken: false,
    top_reduced: false,
    opened_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const neutralAssessment = { atrPercent: 0.01, turningSignal: "none", aboveEMA15m: true };

test("V5.1 shadow takes half at the first target and protects fee break-even", () => {
  const plan = planShadowExit(shadowPosition(), 101.3, neutralAssessment,
    new Date("2026-01-01T01:00:00Z").getTime());
  assert.equal(plan.action, "sell");
  assert.equal(plan.fraction, 0.5);
  assert.equal(plan.reason, "v5.1-first-target");
  assert.equal(plan.targetTaken, true);
  assert.equal(plan.stopPrice, shadowBreakEvenPrice(100));
});

test("V5.1 shadow reduces one third when a top is confirmed", () => {
  const plan = planShadowExit(shadowPosition(), 100.8,
    { ...neutralAssessment, turningSignal: "top" },
    new Date("2026-01-01T01:00:00Z").getTime());
  assert.equal(plan.action, "sell");
  assert.equal(plan.fraction, 1 / 3);
  assert.equal(plan.reason, "v5.1-top-reduction");
  assert.equal(plan.topReduced, true);
  assert.equal(plan.stopPrice, shadowBreakEvenPrice(100));
});

test("V5.1 shadow keeps a slow reversal open for six hours", () => {
  const plan = planShadowExit(shadowPosition({ highest_price: 100.2 }), 99.8,
    { ...neutralAssessment, aboveEMA15m: false },
    new Date("2026-01-01T03:01:00Z").getTime());
  assert.equal(plan.action, "hold");
});

test("V5.1 shadow exits a stagnant position below the 15-minute mean after six hours", () => {
  const plan = planShadowExit(shadowPosition({ highest_price: 100.2 }), 99.8,
    { ...neutralAssessment, aboveEMA15m: false },
    new Date("2026-01-01T06:01:00Z").getTime());
  assert.equal(plan.action, "sell");
  assert.equal(plan.fraction, 1);
  assert.equal(plan.reason, "v5.1-time-stop");
});
