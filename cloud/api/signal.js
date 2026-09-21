import { ensureSchema, getSql } from "../src/db.js";

export default async function handler(_request, response) {
  try {
    await ensureSchema();
    const sql = getSql();
    const [run] = await sql`SELECT strategy FROM strategy_runs WHERE strategy = 'crclb-underlying-v2'`;
    const [signal] = await sql`SELECT released_signal, score, reason, updated_at
      FROM signal_state WHERE symbol = 'CRCLBUSDT'`;
    const [position] = await sql`SELECT symbol FROM positions WHERE symbol = 'CRCLBUSDT'
      AND strategy = 'crclb-underlying-v2'`;
    const fresh = signal && Date.now() - new Date(signal.updated_at).getTime() < 180_000;
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({
      strategy: run?.strategy || null,
      signal: fresh ? signal.released_signal : "unavailable",
      score: fresh ? signal.score : 0,
      reason: fresh ? signal.reason : "stale-signal",
      updatedAt: signal?.updated_at || null,
      hasPosition: Boolean(position),
    });
  } catch (error) {
    console.error(error);
    return response.status(503).json({ error: "signal-unavailable" });
  }
}
