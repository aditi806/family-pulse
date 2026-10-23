// Optional Amazon Bedrock polish step (Converse API). Falls back to the deterministic text
// when BEDROCK_MODEL_ID is unset, the AWS SDK is unavailable, or the call is slow/fails.
const SYSTEM = "You rewrite short household updates so they sound natural when spoken aloud by a voice assistant. " +
  "Keep every fact, name, number and time exactly as given. Do not add facts. Maximum 80 words. No markdown, no emojis.";

export async function polish(text, hint = "") {
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) return { text, source: "rules" };
  try {
    const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
    const client = new BedrockRuntimeClient({});
    const call = client.send(new ConverseCommand({
      modelId,
      system: [{ text: SYSTEM }],
      messages: [{ role: "user", content: [{ text: `${hint}\n\n${text}` }] }],
      inferenceConfig: { maxTokens: 220, temperature: 0.3 },
    }));
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("bedrock timeout")), 4000));
    const out = await Promise.race([call, timeout]);
    const t = out.output?.message?.content?.[0]?.text?.trim();
    return t ? { text: t, source: `bedrock:${modelId}` } : { text, source: "rules" };
  } catch (e) {
    console.error("bedrock polish skipped:", e.message);
    return { text, source: "rules" };
  }
}
