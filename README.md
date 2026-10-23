# FamilyPulse

A self-hosted **MCP server** (Streamable HTTP, spec **2025-11-25**) that lets **Alexa+** coordinate a household's chores, medication check-ins and schedules by voice.

> "Alexa, did Grandpa take his evening medication?" → *"Grandpa has taken 1 of 2 Metformin doses due so far today. The 8 PM dose hasn't been logged."*

Hackathon entry: **Alexa+ track** + **AWS Builder** mini challenge (Bedrock, Lambda, API Gateway, DynamoDB).

## Why
Family coordination lives in group chats and sticky notes. Alexa+ is already in the kitchen, so shared household state should be one sentence away, for kids and grandparents too.

## Tools
| Tool | Example utterance |
|---|---|
| `check_medication` | "Did Grandpa take his evening pill?" |
| `log_medication` | "Grandpa just took his pill." |
| `assign_chore` / `log_chore` / `list_chores` | "Give Leo the dishes." / "Maya walked the dog." |
| `daily_briefing` | "Give me the family briefing." (chores, missed doses, tomorrow, **driver conflicts**) |
| `suggest_rebalance` | "Is the chore split fair?" |
| `list_family_members` | name disambiguation |

All tools return short, speakable sentences plus `structuredContent`, and carry MCP annotations (`readOnlyHint`, etc.). Input errors are returned as tool errors (`isError: true`) so the agent can self-correct.

## Architecture
```
Alexa+ ──MCP (Streamable HTTP, POST /mcp, bearer token)──▶ API Gateway ▶ Lambda (src/lambda.js)
                                                         └▶ or Node server (src/server.js)
   src/transport.js  JSON-RPC over HTTP, sessions, Origin + protocol-version checks, auth
   src/mcp.js        initialize / ping / tools/list / tools/call
   src/tools.js      the 8 tools
   src/store.js      memory | JSON file | DynamoDB
   src/llm.js        optional Amazon Bedrock (Converse API) phrasing for briefings/rebalance
```
The MCP layer is **dependency-free** (Node ≥ 20, zero npm packages). The AWS SDK is only loaded when `FAMILYPULSE_TABLE` / `BEDROCK_MODEL_ID` are set (it is bundled in the Lambda Node runtime).

## Quick start
```bash
npm test                 # 13 protocol + tool tests
npm run demo             # scripted conversation over real HTTP (writes docs/transcript.json)
FAMILYPULSE_TOKEN=devtoken npm start     # http://127.0.0.1:3000/mcp
```
Try it with the MCP Inspector:
```bash
npx @modelcontextprotocol/inspector   # Transport: Streamable HTTP, URL: http://127.0.0.1:3000/mcp, header Authorization: Bearer devtoken
```
Or with curl:
```bash
curl -s localhost:3000/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer devtoken' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' -i
```

## Deploy to AWS
```bash
sam build -t infra/template.yaml   # or: sam deploy --guided -t infra/template.yaml
sam deploy --guided --template-file infra/template.yaml \
  --parameter-overrides McpToken=<long-random-token> BedrockModelId=<optional-model-or-inference-profile-id>
```
The stack creates a DynamoDB table, a Node 22 Lambda and an HTTP API; the `McpEndpoint` output is the URL to register with Alexa+ (see `alexa-plus/mcp-server.json`). Lambda runs the transport **stateless** (no `Mcp-Session-Id`), which the spec allows.

Bedrock is optional: with `BEDROCK_MODEL_ID` unset, replies use the deterministic text; if Bedrock errors or takes > 4 s, the same fallback is used, so voice responses never hang.

## Configuration
| Env | Purpose |
|---|---|
| `FAMILYPULSE_TOKEN` | Bearer token (set it everywhere except local dev) |
| `FAMILYPULSE_TABLE` | DynamoDB table (otherwise JSON file `data/state.json`) |
| `BEDROCK_MODEL_ID` | Enable Bedrock phrasing |
| `FAMILYPULSE_TZ` | Household time zone |
| `ALLOWED_ORIGINS` | Comma-separated allowed browser `Origin`s (requests without `Origin` are fine) |
| `FAMILYPULSE_NOW` | Pin the clock (demos/tests) |

## Security notes
Bearer auth with constant-time compare, Origin validation (DNS-rebinding protection), localhost bind by default, 1 MB body cap. Medication data is sensitive: single-household token auth today; OAuth/account linking for multi-household is the next step. Not a medical device; don't rely on it for critical dosing decisions.

## Status and honesty notes
- Verified locally: protocol conformance tests and the HTTP demo (`npm test`, `npm run demo`).
- The Alexa+ utterance → tool mapping in `scripts/demo.js` is scripted; real Alexa+ preview registration has to be done in your own account.
- The Bedrock and DynamoDB paths are written against the AWS SDK v3 APIs but need an AWS account to exercise.

## License
MIT
