// MCP Streamable HTTP transport as a pure function, shared by Node http and AWS Lambda.
// Implements: POST /mcp (JSON responses), optional Mcp-Session-Id, MCP-Protocol-Version
// validation, Origin checks (DNS-rebinding protection), bearer auth, 202 for notifications.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { SUPPORTED, CODE } from "./mcp.js";

const json = (status, obj, headers = {}) => ({
  status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(obj),
});
const rpcErr = (status, code, message, id = null) => json(status, { jsonrpc: "2.0", id, error: { code, message } });

function authorized(header, token) {
  const a = Buffer.from(header || ""), b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createTransport({ mcp, token, allowedOrigins = [], stateful = true }) {
  const sessions = new Set();
  return async function handle({ method, headers, body }) {
    const origin = headers["origin"];
    if (origin && !allowedOrigins.includes(origin)) return rpcErr(403, CODE.INVALID, "Origin not allowed");
    if (token && !authorized(headers["authorization"], token))
      return json(401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="familypulse"' });

    if (method === "DELETE") {
      const sid = headers["mcp-session-id"];
      if (stateful && sid && sessions.delete(sid)) return { status: 204, headers: {}, body: "" };
      return { status: 405, headers: { allow: "POST" }, body: "" };
    }
    if (method !== "POST") return { status: 405, headers: { allow: "POST, DELETE" }, body: "" }; // no server-initiated stream

    let msg;
    try { msg = JSON.parse(body || ""); } catch { return rpcErr(400, CODE.PARSE, "Parse error"); }
    if (Array.isArray(msg) || typeof msg !== "object" || msg === null || msg.jsonrpc !== "2.0")
      return rpcErr(400, CODE.INVALID, "Invalid Request (single JSON-RPC 2.0 message expected)");

    const isRequest = typeof msg.method === "string" && msg.id !== undefined;
    const isInit = msg.method === "initialize";

    const pv = headers["mcp-protocol-version"];
    if (!isInit && pv && !SUPPORTED.includes(pv))
      return rpcErr(400, CODE.INVALID, `Unsupported MCP-Protocol-Version: ${pv}`, msg.id ?? null);

    if (stateful && !isInit) {
      const sid = headers["mcp-session-id"];
      if (!sid) return rpcErr(400, CODE.INVALID, "Missing Mcp-Session-Id", msg.id ?? null);
      if (!sessions.has(sid)) return rpcErr(404, CODE.INVALID, "Unknown session", msg.id ?? null);
    }
    if (!isRequest) return { status: 202, headers: {}, body: "" }; // notification or client response

    const out = await mcp(msg);
    const extra = {};
    if (isInit && stateful && !out.error) {
      const sid = randomUUID();
      sessions.add(sid);
      extra["mcp-session-id"] = sid;
    }
    return json(200, out, extra);
  };
}
