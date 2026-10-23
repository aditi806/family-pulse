# Demo script (≈2:30)
Record the real thing if you can: terminal running `npm run demo`, then your Alexa+ device or the Alexa+ simulated experience calling your deployed endpoint.

| Time | Show | Say |
|---|---|---|
| 0:00 | Title | "Family coordination lives in group chats. FamilyPulse puts it behind Alexa+ using MCP." |
| 0:15 | Architecture | "A self-hosted MCP server, Streamable HTTP, spec 2025-11-25, on Lambda with DynamoDB and optional Bedrock." |
| 0:30 | Terminal: handshake | "Alexa+ discovers eight tools over MCP." |
| 0:45 | Medication check + log | "Did Grandpa take his evening pill? ... Logged." |
| 1:15 | Chore + briefing | "The briefing catches a driver conflict for tomorrow." |
| 1:50 | Rebalance | "It suggests and applies a fairer split." |
| 2:10 | `npm test` + code (`src/lambda.js`, `src/llm.js`) | "13 protocol tests; Bedrock is used inside the tools." |
| 2:30 | Close | "Next: Ring arrival reminders, OAuth, multi-household." |
