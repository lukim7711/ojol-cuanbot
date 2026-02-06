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

/**
 * Strip <think>...</think> tags yang ditambahkan Qwen3 thinking mode
 */
function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Parse arguments dari tool call — bisa string (JSON) atau object
 * Qwen3 kadang menyisipkan <think> tags di dalam arguments string
 */
function parseToolArguments(args: any): any {
  if (typeof args === "object" && args !== null) {
    return args;
  }

  if (typeof args === "string") {
    // Strip thinking tags dulu
    let cleaned = stripThinkingTags(args);

    // Kadang model mengembalikan string kosong setelah strip
    if (!cleaned) return {};

    // Coba parse JSON
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // Coba extract JSON dari string (mungkin ada teks tambahan)
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (_) {}
      }
      console.error("Failed to parse tool arguments:", cleaned);
      return {};
    }
  }

  return {};
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

  console.log("[AI] Sending to Qwen3, user text:", userText);

  const response = (await env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8" as any, {
    messages,
    tools: TOOLS as any,
  })) as any;

  // Log raw response untuk debugging
  console.log("[AI] Raw response:", JSON.stringify(response));

  // Parse response
  const toolCalls: AIResult["toolCalls"] = [];
  let textResponse: string | null = null;

  // 1. Parse tool_calls
  if (response.tool_calls && Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
    for (const tc of response.tool_calls) {
      const name = tc.name || tc.function?.name;
      const rawArgs = tc.arguments ?? tc.function?.arguments;

      if (!name) {
        console.warn("[AI] Tool call without name:", JSON.stringify(tc));
        continue;
      }

      const parsedArgs = parseToolArguments(rawArgs);
      console.log(`[AI] Tool call: ${name}`, JSON.stringify(parsedArgs));

      toolCalls.push({
        name,
        arguments: parsedArgs,
      });
    }
  }

  // 2. Parse text response
  // Qwen3 bisa mengembalikan di response, content, atau choices[0].message.content
  let rawText = response.response
    ?? response.content
    ?? response.choices?.[0]?.message?.content
    ?? null;

  if (rawText && typeof rawText === "string") {
    // Strip thinking tags dari text response juga
    textResponse = stripThinkingTags(rawText) || null;
  }

  // 3. Fallback: jika tidak ada tool_calls DAN tidak ada text,
  //    coba extract dari response.response yang mungkin berisi JSON
  if (toolCalls.length === 0 && !textResponse && rawText) {
    console.warn("[AI] No tool_calls found, raw text:", rawText);
  }

  console.log(`[AI] Parsed: ${toolCalls.length} tool calls, text: ${textResponse ? 'yes' : 'no'}`);

  return { toolCalls, textResponse };
}
