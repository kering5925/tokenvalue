import { ensureSchema, getSql } from "../src/db.js";
import { TURNING_POINT_SOURCE } from "../src/observations.js";

export default async function handler(_request, response) {
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT DISTINCT ON (symbol)
        symbol, signal, reason, candle_time, checked_at
      FROM signal_observations
      WHERE source = ${TURNING_POINT_SOURCE} AND symbol IN ('ETHUSDT', 'CRCLBUSDT')
      ORDER BY symbol, candle_time DESC`;
    const points = {};
    for (const row of rows) {
      const name = row.symbol === "ETHUSDT" ? "ETH" : "CRCLB";
      const fresh = Date.now() - new Date(row.checked_at).getTime() < 180_000
        && Date.now() - Number(row.candle_time) < 30 * 60_000;
      points[name] = {
        kind: fresh ? row.signal : "unavailable",
        reason: fresh ? row.reason : "云端拐点数据过期",
        candleTime: fresh ? new Date(Number(row.candle_time)).toISOString() : null,
      };
    }
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({ points });
  } catch (error) {
    console.error(error);
    return response.status(503).json({ error: "turning-points-unavailable" });
  }
}
