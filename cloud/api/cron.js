import { runCycle } from "../src/trader.js";

export default async function handler(request, response) {
  if (!process.env.CRON_SECRET || request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return response.status(401).json({ error: "unauthorized" });
  }
  try {
    return response.status(200).json({ ok: true, results: await runCycle() });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
