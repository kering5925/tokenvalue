import { SHADOW_STRATEGY } from "./strategy.js";

const SYMBOL = "CRCLBUSDT";
const SIDE_FEE_RATE = 0.0025;
const POSITION_FRACTION = 0.03;
const FIRST_TARGET_MOVE = 0.013;
const MIN_FAVORABLE_MOVE = 0.005;
const TIME_STOP_MS = 6 * 60 * 60 * 1_000;
const MAX_HOLD_MS = 12 * 60 * 60 * 1_000;

export function shadowBreakEvenPrice(entryPrice, feeRate = SIDE_FEE_RATE) {
  return entryPrice * (1 + feeRate) / (1 - feeRate);
}

export function planShadowExit(position, price, assessment, nowMs = Date.now()) {
  const highestPrice = Math.max(position.highest_price, price);
  const trailingDistance = Math.max(0.009, assessment.atrPercent * 1.2);
  const managedStop = position.target_taken
    ? Math.max(position.stop_price, highestPrice * (1 - trailingDistance))
    : position.stop_price;

  if (price <= managedStop) {
    return { action: "sell", fraction: 1, reason: position.target_taken ? "v5.1-trailing-stop" : "v5.1-structure-stop",
      highestPrice, stopPrice: managedStop };
  }
  if (!position.target_taken && price >= position.entry_price * (1 + FIRST_TARGET_MOVE)) {
    return { action: "sell", fraction: 0.5, reason: "v5.1-first-target",
      highestPrice, stopPrice: Math.max(managedStop, shadowBreakEvenPrice(position.entry_price)), targetTaken: true };
  }
  if (assessment.turningSignal === "top" && !position.top_reduced) {
    const protectedStop = price >= shadowBreakEvenPrice(position.entry_price)
      ? Math.max(managedStop, shadowBreakEvenPrice(position.entry_price)) : managedStop;
    return { action: "sell", fraction: 1 / 3, reason: "v5.1-top-reduction",
      highestPrice, stopPrice: protectedStop, topReduced: true };
  }

  const heldMs = nowMs - new Date(position.opened_at).getTime();
  if (heldMs >= TIME_STOP_MS && highestPrice < position.entry_price * (1 + MIN_FAVORABLE_MOVE)
    && !assessment.aboveEMA15m) {
    return { action: "sell", fraction: 1, reason: "v5.1-time-stop",
      highestPrice, stopPrice: managedStop };
  }
  if (heldMs >= MAX_HOLD_MS) {
    return { action: "sell", fraction: 1, reason: "v5.1-max-hold",
      highestPrice, stopPrice: managedStop };
  }
  return { action: "hold", highestPrice, stopPrice: managedStop };
}

async function openShadowPosition(sql, price, assessment, equity, now) {
  const notional = equity * POSITION_FRACTION;
  if (!Number.isFinite(notional) || notional < 10) return false;
  const quantity = notional / price;
  const fee = notional * SIDE_FEE_RATE;
  await sql.transaction([
    sql`INSERT INTO shadow_positions
      (strategy, symbol, original_quantity, quantity, entry_price, entry_fee, stop_price,
        highest_price, last_price, target_taken, top_reduced, opened_at, entry_candle_time, entry_reason)
      VALUES (${SHADOW_STRATEGY}, ${SYMBOL}, ${quantity}, ${quantity}, ${price}, ${fee},
        ${price * (1 - assessment.stopDistance)}, ${price}, ${price}, false, false, ${now},
        ${assessment.closeTime}, ${assessment.reason})`,
    sql`INSERT INTO shadow_trades
      (strategy, symbol, side, price, quantity, fee, realized_pnl, reason, candle_time, created_at)
      VALUES (${SHADOW_STRATEGY}, ${SYMBOL}, 'BUY', ${price}, ${quantity}, ${fee}, NULL,
        ${assessment.reason}, ${assessment.closeTime}, ${now})`,
  ]);
  return true;
}

async function sellShadowPosition(sql, position, price, plan, assessment, now) {
  const requestedQuantity = position.quantity * plan.fraction;
  const quantity = plan.fraction >= 0.999999 ? position.quantity : requestedQuantity;
  const proceeds = quantity * price;
  const fee = proceeds * SIDE_FEE_RATE;
  const entryFee = position.entry_fee * quantity / position.original_quantity;
  const realizedPnl = proceeds - fee - quantity * position.entry_price - entryFee;
  const remaining = position.quantity - quantity;
  const trade = sql`INSERT INTO shadow_trades
    (strategy, symbol, side, price, quantity, fee, realized_pnl, reason, candle_time, created_at)
    VALUES (${SHADOW_STRATEGY}, ${SYMBOL}, 'SELL', ${price}, ${quantity}, ${fee}, ${realizedPnl},
      ${plan.reason}, ${assessment.closeTime}, ${now})`;
  if (remaining <= position.original_quantity * 1e-8) {
    await sql.transaction([
      trade,
      sql`DELETE FROM shadow_positions WHERE strategy = ${SHADOW_STRATEGY} AND symbol = ${SYMBOL}`,
    ]);
    return false;
  }
  await sql.transaction([
    trade,
    sql`UPDATE shadow_positions SET quantity = ${remaining}, highest_price = ${plan.highestPrice},
      stop_price = ${plan.stopPrice}, target_taken = ${plan.targetTaken || position.target_taken},
      top_reduced = ${plan.topReduced || position.top_reduced}
      WHERE strategy = ${SHADOW_STRATEGY} AND symbol = ${SYMBOL}`,
  ]);
  return true;
}

export async function runShadowStrategy(sql, price, assessment, equity, now = new Date()) {
  const [state] = await sql`SELECT * FROM shadow_strategy_state
    WHERE strategy = ${SHADOW_STRATEGY} AND symbol = ${SYMBOL}`;
  let [position] = await sql`SELECT * FROM shadow_positions
    WHERE strategy = ${SHADOW_STRATEGY} AND symbol = ${SYMBOL}`;
  const isNewCandle = !state || Number(state.last_candle_time) !== assessment.closeTime;
  let action = "none";

  if (position) {
    await sql`UPDATE shadow_positions SET last_price = ${price}
      WHERE strategy = ${SHADOW_STRATEGY} AND symbol = ${SYMBOL}`;
    position = { ...position, last_price: price };
    const plan = planShadowExit(position, price, assessment, now.getTime());
    if (plan.action === "sell") {
      const remainsOpen = await sellShadowPosition(sql, position, price, plan, assessment, now);
      action = plan.reason;
      position = remainsOpen ? { ...position, quantity: position.quantity * (1 - plan.fraction) } : undefined;
    } else if (plan.highestPrice !== position.highest_price || plan.stopPrice !== position.stop_price) {
      await sql`UPDATE shadow_positions SET highest_price = ${plan.highestPrice}, stop_price = ${plan.stopPrice}
        WHERE strategy = ${SHADOW_STRATEGY} AND symbol = ${SYMBOL}`;
    }
  }

  if (action === "none" && !position && isNewCandle && assessment.releasedSignal === "buy") {
    if (await openShadowPosition(sql, price, assessment, equity, now)) action = "buy";
  }

  await sql`INSERT INTO shadow_strategy_state
    (strategy, symbol, last_candle_time, last_signal, updated_at)
    VALUES (${SHADOW_STRATEGY}, ${SYMBOL}, ${assessment.closeTime}, ${assessment.rawSignal}, ${now})
    ON CONFLICT (strategy, symbol) DO UPDATE SET
      last_candle_time = EXCLUDED.last_candle_time, last_signal = EXCLUDED.last_signal,
      updated_at = EXCLUDED.updated_at`;
  return { strategy: SHADOW_STRATEGY, symbol: SYMBOL, action, signal: assessment.rawSignal };
}

export async function getShadowStatus(sql) {
  const positions = await sql`SELECT * FROM shadow_positions WHERE strategy = ${SHADOW_STRATEGY}`;
  const trades = await sql`SELECT * FROM shadow_trades WHERE strategy = ${SHADOW_STRATEGY}
    ORDER BY id DESC LIMIT 50`;
  const [{ realized_pnl: realizedPnl }] = await sql`SELECT COALESCE(SUM(realized_pnl), 0)::float8 AS realized_pnl
    FROM shadow_trades WHERE strategy = ${SHADOW_STRATEGY} AND side = 'SELL'`;
  const unrealizedPnl = positions.reduce((sum, position) => {
    const entryFeeRemaining = position.entry_fee * position.quantity / position.original_quantity;
    const exitFee = position.quantity * position.last_price * SIDE_FEE_RATE;
    return sum + position.quantity * (position.last_price - position.entry_price) - entryFeeRemaining - exitFee;
  }, 0);
  return { strategy: SHADOW_STRATEGY, positionFraction: POSITION_FRACTION,
    realizedPnl, unrealizedPnl, positions, trades };
}
