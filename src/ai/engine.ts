import { Env } from "../config/env";
import { TOOLS } from "./tools";
import { buildSystemPrompt } from "./prompt";

export interface AIResult {
  toolCalls: Array<{
    name: string;
    arguments: any;
  }>;
  textResponse: string | null;
}

interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function runAI(
  env: Env,
  userId: number,
  userText: string,
  conversationHistory: ConversationMessage[] = []
): Promise<AIResult> {
  // Bangun tanggal hari ini (WIB = UTC+7)
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const currentDate = now.toISOString().split("T")[0]; // YYYY-MM-DD

  const messages = [
    { role: "system" as const, content: buildSystemPrompt(currentDate) },
    ...conversationHistory,
    { role: "user" as const, content: userText },
  ];

  const response = await env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8", {
    messages,
    tools: TOOLS as any,
  });

  // Parse response — Workers AI mengembalikan tool_calls jika model memutuskan untuk memanggil tool
  const toolCalls: AIResult["toolCalls"] = [];
  let textResponse: string | null = null;

  if (response.tool_calls && response.tool_calls.length > 0) {
    for (const tc of response.tool_calls) {
      toolCalls.push({
        name: tc.name,
        arguments:
          typeof tc.arguments === "string"
            ? JSON.parse(tc.arguments)
            : tc.arguments,
      });
    }
  }

  // Jika model juga mengembalikan teks (untuk sapaan/basa-basi)
  if (response.response) {
    textResponse = response.response;
  }

  return { toolCalls, textResponse };
}
