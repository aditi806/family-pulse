// Wires store + tools + MCP + transport. Used by the Node server, Lambda and tests.
import { createMcp } from "./mcp.js";
import { createTransport } from "./transport.js";
import { tools } from "./tools.js";
import { now } from "./clock.js";

export function createApp({ store, token, allowedOrigins = [], stateful = true }) {
  const mcp = createMcp({
    tools,
    ctx: { store, now },
    serverInfo: { name: "familypulse", title: "FamilyPulse", version: "1.0.0" },
    instructions:
      "FamilyPulse tracks one household's chores, medication doses and schedule. Keep spoken replies short. " +
      "For 'did X take their pill', call check_medication. For 'X did Y', call log_chore. For a summary, call daily_briefing.",
  });
  return createTransport({ mcp, token, allowedOrigins, stateful });
}
