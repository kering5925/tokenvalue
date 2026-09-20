const required = ["QSTASH_TOKEN", "CRON_SECRET"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is not configured`);
}

const destination = "https://tokenvalue-paper-trader.vercel.app/api/cron";
const baseURL = (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "");
const response = await fetch(`${baseURL}/v2/schedules/${destination}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
    "Content-Type": "application/json",
    "Upstash-Cron": "* * * * *",
    "Upstash-Schedule-Id": "tokenvalue-paper-every-minute",
    "Upstash-Method": "GET",
    "Upstash-Timeout": "50s",
    "Upstash-Retries": "0",
    "Upstash-Forward-Authorization": `Bearer ${process.env.CRON_SECRET}`,
    "Upstash-Redact-Fields": "header[Authorization]",
    "Upstash-Label": "tokenvalue-paper-trader",
  },
  body: "{}",
});

const result = await response.json();
if (!response.ok) throw new Error(`QStash ${response.status}: ${JSON.stringify(result)}`);
console.log(JSON.stringify(result, null, 2));
