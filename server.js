// Local / container entry point: Streamable HTTP MCP endpoint at POST /mcp.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { storeFromEnv } from "./store.js";

export function startServer({ store, token, port = 3000, host = "127.0.0.1", allowedOrigins = [] } = {}) {
  const handle = createApp({ store, token, allowedOrigins, stateful: true });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"ok":true}'); }
    if (url.pathname !== "/mcp") { res.writeHead(404); return res.end(); }
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { res.writeHead(413); return res.end(); } }
    const out = await handle({ method: req.method, headers: req.headers, body });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.FAMILYPULSE_TZ) process.env.TZ = process.env.FAMILYPULSE_TZ;
  const token = process.env.FAMILYPULSE_TOKEN;
  if (!token) console.warn("WARNING: FAMILYPULSE_TOKEN not set, endpoint is unauthenticated (dev only).");
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || "127.0.0.1";
  const origins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
  await startServer({ store: storeFromEnv(), token, port, host, allowedOrigins: origins });
  console.log(`FamilyPulse MCP server (Streamable HTTP, spec 2025-11-25) listening on http://${host}:${port}/mcp`);
}
