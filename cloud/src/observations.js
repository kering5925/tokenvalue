export const TURNING_POINT_SOURCE = "turning-point-v1";

const HORIZONS = [30, 60, 90];

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
  const previous = candles.at(-2);
  const history = candles.slice(-21, -1);
  const range = current.high - current.low;
  if (range <= 0 || current.close <= 0) {
    return { symbol, signal: "unavailable", reason: "K线数据异常", closeTime: null };
  }
  const medianVolume = median(history.map((candle) => candle.volume));
  const activeVolume = medianVolume > 0 && current.volume >= medianVolume * 1.2;
  const previousRSI = rsi(candles, candles.length - 2);
  const currentRSI = rsi(candles, candles.length - 1);
  const priorLow = Math.min(...history.map((candle) => candle.low));
  const priorHigh = Math.max(...history.map((candle) => candle.high));
  let signal = "none";
  let reason = "当前没有满足观察条件";

  if (activeVolume && current.low <= priorLow * 1.003
    && (current.close - current.low) / range >= 0.65
    && current.close > current.open && current.close > previous.close
    && previousRSI <= 42 && currentRSI > previousRSI) {
    signal = "bottom";
    reason = "试探近期低位后收回 · 动能回升 · 放量";
  } else if (activeVolume && current.high >= priorHigh * 0.997
    && (current.high - current.close) / range >= 0.65
    && current.close < current.open && current.close < previous.close
    && previousRSI >= 58 && currentRSI < previousRSI) {
    signal = "top";
    reason = "试探近期高位后回落 · 动能转弱 · 放量";
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

export async function recordObservation(sql, source, symbol, candles, assessment) {
  if (!assessment.closeTime || !Number.isFinite(assessment.close)) return;
  await sql`INSERT INTO signal_observations
    (source, symbol, candle_time, close_price, signal, score, reason)
    VALUES (${source}, ${symbol}, ${assessment.closeTime}, ${assessment.close},
      ${assessment.signal}, ${assessment.score ?? null}, ${assessment.reason})
    ON CONFLICT (source, symbol, candle_time) DO UPDATE SET checked_at = NOW()`;

  const oldestRelevant = candles[0].closeTime;
  const pending = await sql`SELECT source, symbol, candle_time, close_price,
      return_30m, return_60m, return_90m
    FROM signal_observations
    WHERE symbol = ${symbol} AND candle_time >= ${oldestRelevant}
      AND (return_30m IS NULL OR return_60m IS NULL OR return_90m IS NULL)
    ORDER BY candle_time DESC LIMIT 100`;
  for (const row of pending) {
    const returns = outcomeReturns(candles, Number(row.candle_time), row.close_price);
    if (!HORIZONS.some((minutes) => row[`return_${minutes}m`] == null && returns[minutes] != null)) continue;
    await sql`UPDATE signal_observations SET
        return_30m = COALESCE(return_30m, ${returns[30]}),
        return_60m = COALESCE(return_60m, ${returns[60]}),
        return_90m = COALESCE(return_90m, ${returns[90]})
      WHERE source = ${row.source} AND symbol = ${row.symbol} AND candle_time = ${row.candle_time}`;
  }
}
