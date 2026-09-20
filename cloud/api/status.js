import { getStatus } from "../src/trader.js";

export default async function handler(request, response) {
  if (!process.env.STATUS_SECRET || request.headers.authorization !== `Bearer ${process.env.STATUS_SECRET}`) {
    return response.status(401).json({ error: "unauthorized" });
  }
  try {
    return response.status(200).json(await getStatus());
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message });
  }
}
