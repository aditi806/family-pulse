// Minimal, dependency-free MCP server core (JSON-RPC 2.0). Tools capability only.
export const LATEST = "2025-11-25";
export const SUPPORTED = [LATEST, "2025-06-18", "2025-03-26"];
export class ToolError extends Error {}

export const CODE = { PARSE: -32700, INVALID: -32600, NO_METHOD: -32601, PARAMS: -32602, INTERNAL: -32603 };

function validate(schema, args) {
  const errs = [];
  if (args === null || typeof args !== "object" || Array.isArray(args)) return ["arguments must be an object"];
  const props = schema.properties || {};
  for (const r of schema.required || []) if (args[r] === undefined) errs.push(`missing required argument '${r}'`);
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (!p) { errs.push(`unknown argument '${k}'`); continue; }
    const t = p.type;
    if (t === "string" && typeof v !== "string") errs.push(`'${k}' must be a string`);
    else if (t === "boolean" && typeof v !== "boolean") errs.push(`'${k}' must be a boolean`);
    else if (t === "integer" && !Number.isInteger(v)) errs.push(`'${k}' must be an integer`);
    else if (p.enum && !p.enum.includes(v)) errs.push(`'${k}' must be one of: ${p.enum.join(", ")}`);
  }
  return errs;
}

export function createMcp({ tools, serverInfo, instructions, ctx }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return async function handle(msg) {
    const { id, method, params } = msg;
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    switch (method) {
      case "initialize": {
        const asked = params?.protocolVersion;
        return ok({
          protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          instructions,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: tools.map(({ handler, ...t }) => t) });
      case "tools/call": {
        const tool = byName.get(params?.name);
        if (!tool) return fail(CODE.PARAMS, `Unknown tool: ${params?.name}`);
        const args = params.arguments ?? {};
        const errs = validate(tool.inputSchema, args);
        // Validation problems are tool-execution errors so the model can self-correct.
        if (errs.length) return ok({ isError: true, content: [{ type: "text", text: `Invalid arguments: ${errs.join("; ")}.` }] });
        try {
          const { text, data } = await tool.handler(args, ctx);
          return ok({ content: [{ type: "text", text }], structuredContent: data ?? {}, isError: false });
        } catch (e) {
          if (e instanceof ToolError) return ok({ isError: true, content: [{ type: "text", text: e.message }] });
          console.error("tool failure:", e);
          return ok({ isError: true, content: [{ type: "text", text: "Sorry, something went wrong on my side." }] });
        }
      }
      default:
        return fail(CODE.NO_METHOD, `Method not found: ${method}`);
    }
  };
}
