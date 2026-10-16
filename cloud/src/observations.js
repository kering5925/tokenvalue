export const TURNING_POINT_SOURCE = "turning-point-v3";

const HORIZONS = [30, 60, 90, 180, 360, 720, 1440];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function rsi(candles, endingAt) {
  let gains = 0;
  let losses = 0;
  for (let index = endingAt - 13; index <= endingAt; index++) {
    const change = candles[index].close - candles[index - 1].close;
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
}

export function assessTurningPoint(symbol, candles, now = Date.now()) {
  const current = candles.at(-1);
  if (candles.length < 35 || !current || now < current.closeTime
    || now - current.closeTime >= 30 * 60_000) {
    return { symbol, signal: "unavailable", reason: "15分钟K线不足或过期", closeTime: null };
  }
  const candidate = candles.at(-2);
  const previous = candles.at(-3);
  const history = candles.slice(-22, -2);
  const range = candidate.high - candidate.low;
  const currentRange = current.high - current.low;
  if (range <= 0 || currentRange <= 0 || current.close <= 0
    || current.closeTime - candidate.closeTime !== 15 * 60_000) {
    return { symbol, signal: "unavailable", reason: "K线数据异常", closeTime: null };
  }
  const medianVolume = median(history.map((candle) => candle.volume));
  const activeVolume = medianVolume > 0 && candidate.volume >= medianVolume * 1.2;
  const previousRSI = rsi(candles, candles.length - 3);
  const candidateRSI = rsi(candles, candles.length - 2);
  const priorLow = Math.min(...history.map((candle) => candle.low));
  const topHistory = candles.slice(-21, -1);
  const topVolume = median(topHistory.map((candle) => candle.volume));
  const priorHigh = Math.max(...topHistory.map((candle) => candle.high));
  let signal = "none";
  let reason = "当前没有满足观察条件";

  if (topVolume > 0 && current.volume >= topVolume * 1.2
    && current.high >= priorHigh * 0.997
    && (current.high - current.close) / currentRange >= 0.65
    && current.close < current.open && current.close < candidate.close
    && candidateRSI >= 58 && rsi(candles, candles.length - 1) < candidateRSI) {
    signal = "top";
    reason = "试探近期高位后回落 · 动能转弱 · 放量";
  } else if (activeVolume && candidate.low <= priorLow * 1.003
    && (candidate.close - candidate.low) / range >= 0.65
    && candidate.close > candidate.open && candidate.close > previous.close
    && previousRSI <= 42 && candidateRSI > previousRSI
    && current.close > candidate.high && current.close > current.open) {
    signal = "bottom";
    reason = "低位收回后下一根突破前高 · 放量确认";
  } else {
    const watchHistory = candles.slice(-21, -1);
    const watchMedianVolume = median(watchHistory.map((candle) => candle.volume));
    const watchPriorLow = Math.min(...watchHistory.map((candle) => candle.low));
    const currentRSI = rsi(candles, candles.length - 1);
    if (watchMedianVolume > 0 && current.volume >= watchMedianVolume * 1.2
      && current.low <= watchPriorLow * 1.003
      && (current.close - current.low) / currentRange >= 0.65
      && current.close > current.open && current.close > candidate.close
      && candidateRSI <= 42 && currentRSI > candidateRSI) {
      signal = "bottom-watch";
      reason = "低位放量收回 · 筑底形成中 · 等待下一根突破确认";
    }
  }
  return { symbol, signal, reason, closeTime: current.closeTime, close: current.close };
}

export function outcomeReturns(candles, candleTime, closePrice) {
  const closes = new Map(candles.map((candle) => [candle.closeTime, candle.close]));
  return Object.fromEntries(HORIZONS.map((minutes) => {
    const futureClose = closes.get(candleTime + minutes * 60_000);
    return [minutes, futureClose == null ? null : futureClose / closePrice - 1];
  }));
}

export function outcomeMetrics(candles, candleTime, closePrice) {
  const returns = outcomeReturns(candles, candleTime, closePrice);
  const complete90m = returns[90] != null;
  const window90m = complete90m
    ? candles.filter((candle) => candle.closeTime > candleTime
      && candle.closeTime <= candleTime + 90 * 60_000)
    : [];
  return {
    returns,
    mfe90m: complete90m
      ? Math.max(...window90m.map((candle) => (candle.high ?? candle.close) / closePrice - 1))
      : null,
    mae90m: complete90m
      ? Math.min(...window90m.map((candle) => (candle.low ?? candle.close) / closePrice - 1))
      : null,
  };
}

export async function recordObservation(sql, source, symbol, candles, assessment) {
  if (!assessment.closeTime || !Number.isFinite(assessment.close)) return;
  await sql`INSERT INTO signal_observations
    (source, symbol, candle_time, close_price, signal, score, reason, context)
    VALUES (${source}, ${symbol}, ${assessment.closeTime}, ${assessment.close},
      ${assessment.signal}, ${assessment.score ?? null}, ${assessment.reason},
      CAST(${JSON.stringify(assessment.context ?? {})} AS jsonb))
    ON CONFLICT (source, symbol, candle_time) DO UPDATE SET checked_at = NOW()`;

  const oldestRelevant = candles[0].closeTime;
  const pending = await sql`SELECT source, symbol, candle_time, close_price,
      return_30m, return_60m, return_90m, return_180m, return_360m, return_720m,
      return_1440m, mfe_90m, mae_90m
    FROM signal_observations
    WHERE symbol = ${symbol} AND candle_time >= ${oldestRelevant}
      AND (return_30m IS NULL OR return_60m IS NULL OR return_90m IS NULL
        OR return_180m IS NULL OR return_360m IS NULL OR return_720m IS NULL
        OR return_1440m IS NULL OR mfe_90m IS NULL OR mae_90m IS NULL)
    ORDER BY candle_time DESC LIMIT 300`;
  for (const row of pending) {
    const metrics = outcomeMetrics(candles, Number(row.candle_time), row.close_price);
    const returns = metrics.returns;
    const hasUpdate = HORIZONS.some((minutes) => row[`return_${minutes}m`] == null && returns[minutes] != null)
      || (row.mfe_90m == null && metrics.mfe90m != null)
      || (row.mae_90m == null && metrics.mae90m != null);
    if (!hasUpdate) continue;
    await sql`UPDATE signal_observations SET
        return_30m = COALESCE(return_30m, ${returns[30]}),
        return_60m = COALESCE(return_60m, ${returns[60]}),
        return_90m = COALESCE(return_90m, ${returns[90]}),
        return_180m = COALESCE(return_180m, ${returns[180]}),
        return_360m = COALESCE(return_360m, ${returns[360]}),
        return_720m = COALESCE(return_720m, ${returns[720]}),
        return_1440m = COALESCE(return_1440m, ${returns[1440]}),
        mfe_90m = COALESCE(mfe_90m, ${metrics.mfe90m}),
        mae_90m = COALESCE(mae_90m, ${metrics.mae90m})
      WHERE source = ${row.source} AND symbol = ${row.symbol} AND candle_time = ${row.candle_time}`;
  }
}
