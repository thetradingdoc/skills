import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

async function main() {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  console.log("ANTHROPIC_API_KEY present:", hasKey);
  if (!hasKey) {
    console.log("No key set, skipping live API call.");
    return;
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
  });

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: "Reply with exactly the word: ok",
      },
    ],
  });

  console.log("Anthropic message.type:", msg.type);
  const first = msg.content[0];
  if (first && first.type === "text") {
    console.log("First text block snippet:", first.text.slice(0, 32));
  } else {
    console.log("First content block is non-text:", first?.type);
  }
}

main().catch((err) => {
  console.error("Anthropic test error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

