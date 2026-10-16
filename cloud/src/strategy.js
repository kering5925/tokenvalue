import { assessTurningPoint } from "./observations.js";

export const ROUND_TRIP_COST = 0.005;
export const SHADOW_STRATEGY = "crclb-v5-1-shadow";

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

function trend(candles) {
  if (candles.length < 51) return null;
  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const currentEMA20 = ema20.at(-1);
  const previousEMA20 = ema20.at(-2);
  const close = closes.at(-1);
  return {
    close,
    ema20: currentEMA20,
    ema50: ema50.at(-1),
    slope: currentEMA20 / previousEMA20 - 1,
    up: close > currentEMA20 && currentEMA20 > ema50.at(-1) && currentEMA20 >= previousEMA20,
    risk: close < currentEMA20 && currentEMA20 < previousEMA20,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
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
  const atrValue = atr(fifteenMinute);
  const atrPercent = atrValue / latest15m.close;
  const reclaimedEMA = previous15m.close <= previousEMA15m * 1.003 && latest15m.close > currentEMA15m;
  const touchedEMA = previous15m.low <= previousEMA15m + atrValue * 0.25
    && previous15m.close >= previousEMA15m - atrValue * 0.5;
  const pullbackConfirmed = touchedEMA && latest15m.close > previous15m.high
    && latest15m.close > currentEMA15m && latest15m.close > latest15m.open;
  const notExtended = latest15m.close - currentEMA15m <= atrValue * 1.5;
  const topConfirmed = assessTurningPoint("CRCLBUSDT", fifteenMinute, latest15m.closeTime + 1).signal === "top";
  const emaFalling = currentEMA15m < previousEMA15m;
  const belowEMAConfirmed = previous15m.close < previousEMA15m && latest15m.close < currentEMA15m;
  const recentSupport = Math.min(...fifteenMinute.slice(-17, -1).map((candle) => candle.low));
  const structureBreak = latest15m.close < recentSupport;
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
    && (pullbackConfirmed || reclaimedEMA)
    && volumeRatio >= 1.25
    && enoughMovement
    && notExtended
    && !topConfirmed;

  let score = 0;
  if (hourlyTrendUp) score += 25;
  if (underlyingConfirmed) score += 25;
  if (fairPrice) score += 15;
  if (volumeConfirmed) score += 15;
  if (reclaimedEMA || pullbackConfirmed) score += 15;
  if (enoughMovement) score += 5;
  if (offHours) {
    score = (hourlyTrendUp ? 25 : 0) + (volumeRatio >= 1.25 ? 25 : 0)
      + (pullbackConfirmed || reclaimedEMA ? 25 : 0) + (enoughMovement && notExtended ? 25 : 0);
  }

  const regularBuy = score >= 85
    && hourlyTrendUp
    && underlyingConfirmed
    && fairPrice
    && volumeConfirmed
    && (reclaimedEMA || pullbackConfirmed)
    && enoughMovement
    && notExtended
    && !topConfirmed;
  const buy = regularBuy || tokenOnlyEntry;
  const trendRisk = (underlying?.marketOpen
    && underlying?.fresh
    && underlying.price < underlying.ema20
    && latest15m.close < currentEMA15m)
    || (offHours && !hourlyTrendUp && latest15m.close < currentEMA15m);
  const rawSignal = buy ? "buy" : trendRisk ? "risk" : "neutral";

  return {
    close: latest15m.close,
    closeTime: latest15m.closeTime,
    rawSignal,
    releasedSignal: rawSignal,
    score,
    samples: 0,
    winRate: null,
    averageNetReturn: null,
    atrPercent,
    premium,
    reason: buy ? (offHours ? "token-only-entry" : "confirmed-entry")
      : trendRisk ? "trend-risk"
        : marketReason(underlying, !notExtended),
    context: {
      marketOpen: Boolean(underlying?.marketOpen), hourlyTrendUp, volumeRatio, atrPercent,
      emaFalling, belowEMAConfirmed, structureBreak, topConfirmed, notExtended,
      reclaimedEMA, pullbackConfirmed, underlyingConfirmed, fairPrice, enoughMovement, premium,
      underlyingPrice: underlying?.price ?? null,
      underlyingSessionOpen: underlying?.sessionOpen ?? null,
      underlyingEMA20: underlying?.ema20 ?? null,
      underlyingFresh: Boolean(underlying?.fresh),
    },
  };
}

export function assessCRCLBShadow(fifteenMinute, fourHour, btcFourHour, ethFourHour, underlying) {
  if (fifteenMinute.length < 51 || fourHour.length < 51
    || btcFourHour.length < 51 || ethFourHour.length < 51) {
    return neutral("insufficient-shadow-history");
  }

  const latest = fifteenMinute.at(-1);
  const previous = fifteenMinute.at(-2);
  const closes15m = fifteenMinute.map((candle) => candle.close);
  const ema20_15m = ema(closes15m, 20);
  const currentEMA15m = ema20_15m.at(-1);
  const previousEMA15m = ema20_15m.at(-2);
  const atrValue = atr(fifteenMinute);
  const atrPercent = atrValue / latest.close;
  const volumeMedian = median(fifteenMinute.slice(-21, -1).map((candle) => candle.volume));
  const volumeRatio = volumeMedian > 0 ? latest.volume / volumeMedian : 0;
  const takerBuyRatio = Number.isFinite(latest.takerBuyRatio) ? latest.takerBuyRatio : null;
  const reclaimedEMA = previous.close <= previousEMA15m * 1.003 && latest.close > currentEMA15m;
  const higherLow = latest.low > previous.low;
  const recentSupport = Math.min(...fifteenMinute.slice(-17, -1).map((candle) => candle.low));
  const structureBreak = latest.close < recentSupport;
  const turning = assessTurningPoint("CRCLBUSDT", fifteenMinute, latest.closeTime + 1);

  const crclbTrend = trend(fourHour);
  const btcTrend = trend(btcFourHour);
  const ethTrend = trend(ethFourHour);
  const broadRisk = btcTrend.risk && ethTrend.risk;
  const fourHourStable = crclbTrend.slope >= -0.002 && latest.close >= recentSupport;
  const regime = crclbTrend.up && !broadRisk ? "trend"
    : fourHourStable && !broadRisk ? "range" : "risk";

  const directionalVolume = takerBuyRatio !== null
    && takerBuyRatio >= 0.55
    && volumeRatio >= 0.8
    && (volumeRatio <= 1.25 || takerBuyRatio >= 0.60);
  const costQualified = atrPercent >= ROUND_TRIP_COST * 0.8;
  const referencePrice = underlying?.referencePrice ?? null;
  const premium = referencePrice ? latest.close / referencePrice - 1 : null;
  const fairAnchor = premium !== null && premium >= -0.05 && premium <= 0.01;
  const topConfirmed = turning.signal === "top";
  const bottomSetup = turning.signal === "bottom-watch" || turning.signal === "bottom";
  const entrySafe = fairAnchor && !structureBreak && !topConfirmed;
  const trendEntry = regime === "trend" && bottomSetup && reclaimedEMA && higherLow
    && directionalVolume && entrySafe;
  const reversalEntry = regime !== "trend" && turning.signal === "bottom"
    && directionalVolume && entrySafe;
  const buy = trendEntry || reversalEntry;

  let score = 0;
  if (regime === "trend") score += 20;
  else if (regime === "range") score += 10;
  if (turning.signal === "bottom") score += 25;
  else if (turning.signal === "bottom-watch") score += 10;
  if (reclaimedEMA && higherLow) score += 20;
  if (directionalVolume) score += 20;
  if (costQualified) score += 5;
  if (fairAnchor) score += 10;
  if (!structureBreak && !topConfirmed) score += 10;
  score = Math.min(score, 100);

  const rawStopDistance = (latest.close - Math.min(recentSupport, previous.low)) / latest.close + 0.002;
  const stopDistance = clamp(rawStopDistance, 0.009, 0.018);
  const rawSignal = buy ? "buy" : regime === "risk" || structureBreak ? "risk" : "neutral";
  const reason = buy ? (trendEntry ? "v5.1-trend-pullback" : "v5.1-left-reversal")
    : turning.signal === "bottom-watch" ? "v5.1-bottom-watch"
      : topConfirmed ? "v5.1-top-warning"
        : regime === "risk" ? "v5.1-risk-wait" : "v5.1-conditions-not-met";

  return {
    close: latest.close,
    closeTime: latest.closeTime,
    rawSignal,
    releasedSignal: rawSignal,
    signal: rawSignal,
    score,
    reason,
    atrPercent,
    premium,
    stopDistance,
    aboveEMA15m: latest.close > currentEMA15m,
    turningSignal: turning.signal,
    context: {
      regime,
      marketOpen: Boolean(underlying?.marketOpen),
      extendedOpen: Boolean(underlying?.extendedOpen),
      referenceFresh: Boolean(underlying?.referenceFresh),
      referencePrice,
      premium,
      fourHourSlope: crclbTrend.slope,
      fourHourUp: crclbTrend.up,
      fourHourStable,
      btcFourHourRisk: btcTrend.risk,
      ethFourHourRisk: ethTrend.risk,
      broadRisk,
      volumeRatio,
      takerBuyRatio,
      directionalVolume,
      atrPercent,
      costQualified,
      reclaimedEMA,
      higherLow,
      structureBreak,
      turningSignal: turning.signal,
      bottomSetup,
      fairAnchor,
      entrySafe,
      trendEntry,
      reversalEntry,
      aboveEMA15m: latest.close > currentEMA15m,
      stopDistance,
    },
  };
}

function marketReason(underlying, extended) {
  if (extended) return "overextended";
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
    winRate: null,
    averageNetReturn: null,
    atrPercent: 0,
    premium: null,
    reason,
    context: {},
  };
}
