// Scripted "Alexa+ style" conversation against the real HTTP endpoint.
// Alexa+ turns an utterance into MCP tool calls; here the utterance -> tool mapping is scripted
// so the demo is deterministic and runs offline. Writes docs/transcript.json for the demo video.
process.env.TZ ||= "Asia/Kolkata";
process.env.FAMILYPULSE_NOW ||= "2026-10-23T20:30:00+05:30";
import { writeFile } from "node:fs/promises";
import { startServer } from "./../src/server.js";
import { memoryStore, seed } from "../src/store.js";

const TOKEN = "demo-token";
let url = process.env.MCP_URL, server;
if (!url) {
  server = await startServer({ store: memoryStore(seed()), token: TOKEN, port: 0 });
  url = `http://127.0.0.1:${server.address().port}/mcp`;
}
const auth = process.env.FAMILYPULSE_TOKEN || TOKEN;
let id = 1, sid, transcript = [];
async function rpc(msg, extra = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${auth}`,
      ...(sid ? { "mcp-session-id": sid, "mcp-protocol-version": "2025-11-25" } : {}), ...extra },
    body: JSON.stringify({ jsonrpc: "2.0", ...msg }),
  });
  if (r.headers.get("mcp-session-id")) sid = r.headers.get("mcp-session-id");
  return { status: r.status, body: r.status === 202 ? null : await r.json() };
}
const line = (s = "") => console.log(s);

line(`# FamilyPulse MCP demo  ->  ${url}`);
const init = await rpc({ id: id++, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "alexa-plus-sim", version: "0.1" } } });
await rpc({ method: "notifications/initialized" });
const tl = await rpc({ id: id++, method: "tools/list" });
line(`initialize -> protocol ${init.body.result.protocolVersion}, server ${init.body.result.serverInfo.name}, session ${sid.slice(0, 8)}…`);
line(`tools/list -> ${tl.body.result.tools.map((t) => t.name).join(", ")}`);
transcript.push({ type: "handshake", protocol: init.body.result.protocolVersion, server: init.body.result.serverInfo.name, tools: tl.body.result.tools.map((t) => t.name) });

const script = [
  ["Alexa, did Grandpa take his evening medication?", "check_medication", { member: "Grandpa" }],
  ["Alexa, tell FamilyPulse Grandpa just took his pill.", "log_medication", { member: "Grandpa", medication: "Metformin" }],
  ["Alexa, Maya walked the dog.", "log_chore", { member: "Maya", chore: "walked the dog" }],
  ["Alexa, give me the family briefing.", "daily_briefing", {}],
  ["Alexa, is the chore split fair?", "suggest_rebalance", {}],
  ["Alexa, yes, apply that.", "suggest_rebalance", { apply: true }],
];
for (const [say, name, args] of script) {
  const r = await rpc({ id: id++, method: "tools/call", params: { name, arguments: args } });
  const text = r.body.result.content[0].text;
  line(`\n🗣  ${say}\n→ tools/call ${name} ${JSON.stringify(args)}\n← ${text}`);
  transcript.push({ type: "turn", say, tool: name, args, reply: text, isError: r.body.result.isError });
}
await writeFile(new URL("../docs/transcript.json", import.meta.url), JSON.stringify(transcript, null, 2));
server?.close();
