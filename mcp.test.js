process.env.TZ = "Asia/Kolkata";
process.env.FAMILYPULSE_NOW = "2026-10-23T20:30:00+05:30";
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { memoryStore, seed } from "../src/store.js";

const mk = (opts = {}) => createApp({ store: memoryStore(seed()), stateful: true, ...opts });
let n = 1;
const post = (app, msg, headers = {}) => app({ method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...msg }) });
async function session(app) {
  const r = await post(app, { id: n++, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  const h = { "mcp-session-id": r.headers["mcp-session-id"], "mcp-protocol-version": "2025-11-25" };
  await post(app, { method: "notifications/initialized" }, h);
  return h;
}
const call = async (app, h, name, args = {}) => JSON.parse((await post(app, { id: n++, method: "tools/call", params: { name, arguments: args } }, h)).body).result;

test("initialize negotiates 2025-11-25 and issues a session", async () => {
  const app = mk();
  const r = await post(app, { id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } });
  const b = JSON.parse(r.body);
  assert.equal(r.status, 200);
  assert.equal(b.result.protocolVersion, "2025-11-25");
  assert.ok(r.headers["mcp-session-id"]);
  assert.ok(b.result.capabilities.tools);
});

test("unknown protocol version falls back to latest", async () => {
  const r = await post(mk(), { id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(JSON.parse(r.body).result.protocolVersion, "2025-11-25");
});

test("notifications get 202, GET gets 405, batches rejected", async () => {
  const app = mk(); const h = await session(app);
  assert.equal((await post(app, { method: "notifications/initialized" }, h)).status, 202);
  assert.equal((await app({ method: "GET", headers: h, body: "" })).status, 405);
  assert.equal((await app({ method: "POST", headers: h, body: "[]" })).status, 400);
});

test("requests need a valid session; bad protocol header rejected", async () => {
  const app = mk(); const h = await session(app);
  assert.equal((await post(app, { id: 9, method: "tools/list" })).status, 400);
  assert.equal((await post(app, { id: 9, method: "tools/list" }, { "mcp-session-id": "nope" })).status, 404);
  assert.equal((await post(app, { id: 9, method: "tools/list" }, { ...h, "mcp-protocol-version": "1999-01-01" })).status, 400);
});

test("tools/list exposes all tools with schemas and annotations", async () => {
  const app = mk(); const h = await session(app);
  const r = JSON.parse((await post(app, { id: 5, method: "tools/list" }, h)).body).result.tools;
  assert.deepEqual(r.map((t) => t.name).sort(), ["assign_chore", "check_medication", "daily_briefing", "list_chores", "list_family_members", "log_chore", "log_medication", "suggest_rebalance"]);
  assert.ok(r.every((t) => t.inputSchema.type === "object" && t.annotations));
});

test("check_medication finds the missed evening dose", async () => {
  const app = mk(); const h = await session(app);
  const r = await call(app, h, "check_medication", { member: "Grandpa" });
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /1 of 2 Metformin/);
  assert.match(r.content[0].text, /8 PM dose hasn't been logged/);
});

test("log_medication then check_medication is up to date", async () => {
  const app = mk(); const h = await session(app);
  await call(app, h, "log_medication", { member: "dada" }); // alias
  const r = await call(app, h, "check_medication", { member: "Grandpa" });
  assert.match(r.content[0].text, /up to date on Metformin/);
});

test("log_chore marks the matching pending chore done", async () => {
  const app = mk(); const h = await session(app);
  const r = await call(app, h, "log_chore", { member: "Maya", chore: "walked the dog" });
  assert.match(r.content[0].text, /marked Walk the dog as done/);
  assert.equal(r.structuredContent.remaining, 2);
});

test("validation errors and unknown people come back as tool errors", async () => {
  const app = mk(); const h = await session(app);
  assert.equal((await call(app, h, "log_chore", { member: "Maya" })).isError, true);
  const r = await call(app, h, "check_medication", { member: "Zed" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /don't know a family member/);
  const bad = JSON.parse((await post(app, { id: 77, method: "tools/call", params: { name: "nope" } }, h)).body);
  assert.equal(bad.error.code, -32602);
});

test("daily_briefing mentions the driver conflict", async () => {
  const app = mk(); const h = await session(app);
  const r = await call(app, h, "daily_briefing");
  assert.match(r.content[0].text, /both need Mom as driver/);
  assert.match(r.content[0].text, /Metformin hasn't been logged/);
});

test("suggest_rebalance suggests then applies", async () => {
  const app = mk(); const h = await session(app);
  const s = await call(app, h, "suggest_rebalance");
  assert.equal(s.structuredContent.suggestion.from, "maya");
  assert.equal(s.structuredContent.moved, null);
  const a = await call(app, h, "suggest_rebalance", { apply: true });
  assert.equal(a.structuredContent.moved.to, "leo");
  const again = await call(app, h, "suggest_rebalance");
  assert.match(again.content[0].text, /balanced/);
});

test("bearer auth and origin checks", async () => {
  const app = mk({ token: "secret" });
  assert.equal((await post(app, { id: 1, method: "initialize", params: {} })).status, 401);
  assert.equal((await post(app, { id: 1, method: "initialize", params: {} }, { authorization: "Bearer secret" })).status, 200);
  assert.equal((await post(app, { id: 1, method: "initialize", params: {} }, { authorization: "Bearer secret", origin: "https://evil.example" })).status, 403);
});

test("stateless mode (Lambda) issues no session and needs none", async () => {
  const app = mk({ stateful: false });
  const r = await post(app, { id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } });
  assert.equal(r.headers["mcp-session-id"], undefined);
  assert.equal((await post(app, { id: 2, method: "tools/list" })).status, 200);
});
