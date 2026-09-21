export const ROUND_TRIP_COST = 0.005;

function ema(values, period) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0]];
  for (const value of values.slice(1)) {
    result.push(value * multiplier + result.at(-1) * (1 - multiplier));
  }
  return result;
}

function atr(candles, period = 14) {
  if (candles.length <= period) return 0;
  let total = 0;
  for (let index = candles.length - period; index < candles.length; index++) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;
    total += Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  }
  return total / period;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function assessCRCLB(fiveMinute, fifteenMinute, hourly, underlying) {
  if (fiveMinute.length < 20 || fifteenMinute.length < 51 || hourly.length < 51) {
    return neutral("insufficient-history");
  }

  const latest15m = fifteenMinute.at(-1);
  const previous15m = fifteenMinute.at(-2);
  const closes15m = fifteenMinute.map((candle) => candle.close);
  const closes1h = hourly.map((candle) => candle.close);
  const ema20_15m = ema(closes15m, 20);
  const ema20_1h = ema(closes1h, 20);
  const ema50_1h = ema(closes1h, 50);
  const currentEMA15m = ema20_15m.at(-1);
  const previousEMA15m = ema20_15m.at(-2);
  const hourlyTrendUp = ema20_1h.at(-1) > ema50_1h.at(-1) && closes1h.at(-1) > ema20_1h.at(-1);
  const volumeMedian = median(fifteenMinute.slice(-21, -1).map((candle) => candle.volume));
  const volumeRatio = volumeMedian > 0 ? latest15m.volume / volumeMedian : 0;
  const reclaimedEMA = previous15m.close <= previousEMA15m * 1.003 && latest15m.close > currentEMA15m;
  const recentHigh = Math.max(...fifteenMinute.slice(-9, -1).map((candle) => candle.high));
  const breakout = latest15m.close > recentHigh;
  const atrValue = atr(fifteenMinute);
  const atrPercent = atrValue / latest15m.close;
  const premium = underlying?.price ? latest15m.close / underlying.price - 1 : null;
  const underlyingConfirmed = Boolean(
    underlying?.marketOpen
    && underlying?.fresh
    && underlying.price > underlying.sessionOpen
    && underlying.price >= underlying.ema20,
  );
  const fairPrice = premium !== null && premium >= -0.03 && premium <= 0.0075;
  const enoughMovement = atrPercent >= ROUND_TRIP_COST * 1.5;
  const volumeConfirmed = volumeRatio >= 1.25;
  const offHours = !underlying?.marketOpen;
  const tokenOnlyEntry = offHours
    && hourlyTrendUp
    && breakout
    && volumeRatio >= 1.5
    && enoughMovement;

  let score = 0;
  if (hourlyTrendUp) score += 25;
  if (underlyingConfirmed) score += 25;
  if (fairPrice) score += 15;
  if (volumeConfirmed) score += 15;
  if (reclaimedEMA || breakout) score += 15;
  if (enoughMovement) score += 5;
  if (offHours) {
    score = (hourlyTrendUp ? 25 : 0) + (volumeRatio >= 1.5 ? 25 : 0)
      + (breakout ? 25 : 0) + (enoughMovement ? 25 : 0);
  }

  const regularBuy = score >= 85
    && hourlyTrendUp
    && underlyingConfirmed
    && fairPrice
    && volumeConfirmed
    && (reclaimedEMA || breakout)
    && enoughMovement;
  const buy = regularBuy || tokenOnlyEntry;
  const sell = (underlying?.marketOpen
    && underlying?.fresh
    && underlying.price < underlying.ema20
    && latest15m.close < currentEMA15m)
    || (offHours && !hourlyTrendUp && latest15m.close < currentEMA15m);

  return {
    close: latest15m.close,
    closeTime: latest15m.closeTime,
    rawSignal: buy ? "buy" : sell ? "sell" : "neutral",
    releasedSignal: buy ? "buy" : sell ? "sell" : "neutral",
    score,
    samples: 0,
    winRate: 0,
    averageNetReturn: 0,
    atrPercent,
    premium,
    reason: buy ? (offHours ? "token-only-entry" : "confirmed-entry")
      : sell ? (offHours ? "token-only-exit" : "trend-exit") : marketReason(underlying),
  };
}

function marketReason(underlying) {
  if (!underlying?.marketOpen) return "off-hours-conditions-not-met";
  if (!underlying?.fresh) return "stale-underlying";
  return "conditions-not-met";
}

function neutral(reason) {
  return {
    closeTime: 0,
    rawSignal: "neutral",
    releasedSignal: "neutral",
    score: 0,
    samples: 0,
    winRate: 0,
    averageNetReturn: 0,
    atrPercent: 0,
    premium: null,
    reason,
  };
}
