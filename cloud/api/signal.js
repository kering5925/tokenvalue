import { getSql } from "../src/db.js";
import { SHADOW_STRATEGY } from "../src/strategy.js";

export default async function handler(_request, response) {
  try {
    const sql = getSql();
    const [signal] = await sql`SELECT signal, score, reason, checked_at
      FROM signal_observations WHERE source = ${SHADOW_STRATEGY} AND symbol = 'CRCLBUSDT'
      ORDER BY candle_time DESC LIMIT 1`;
    const [position] = await sql`SELECT symbol FROM shadow_positions WHERE symbol = 'CRCLBUSDT'
      AND strategy = ${SHADOW_STRATEGY}`;
    const fresh = signal && Date.now() - new Date(signal.checked_at).getTime() < 180_000;
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({
      strategy: SHADOW_STRATEGY,
      signal: fresh ? signal.signal : "unavailable",
      score: fresh ? signal.score : 0,
      reason: fresh ? signal.reason : "stale-signal",
      updatedAt: signal?.checked_at || null,
      hasPosition: Boolean(position),
    });
  } catch (error) {
    console.error(error);
    return response.status(503).json({ error: "signal-unavailable" });
  }
}
