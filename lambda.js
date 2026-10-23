// AWS Lambda entry point (API Gateway HTTP API, payload v2). Stateless: no Mcp-Session-Id issued.
import { createApp } from "./app.js";
import { storeFromEnv } from "./store.js";

let handle;
export async function handler(event) {
  handle ??= createApp({
    store: storeFromEnv(), token: process.env.FAMILYPULSE_TOKEN,
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean), stateful: false,
  });
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString() : event.body || "";
  const out = await handle({ method: event.requestContext?.http?.method || "POST", headers, body });
  return { statusCode: out.status, headers: out.headers, body: out.body };
}
