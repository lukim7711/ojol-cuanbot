/**
 * AI Response Parser
 * Handles parsing of raw AI responses into structured AIResult format.
 * Includes tool argument parsing, deep JSON parsing, and think-tag stripping.
 */

export interface AIResult {
  toolCalls: Array<{
    name: string;
    arguments: any;
  }>;
  textResponse: string | null;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Strip <think>...</think> tags from Qwen's thinking mode
 */
export function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Parse arguments dari tool call — bisa string (JSON) atau object
 */
export function parseToolArguments(args: any): any {
  if (typeof args === "object" && args !== null) {
    return args;
  }

  if (typeof args === "string") {
    let cleaned = stripThinkingTags(args);
    if (!cleaned) return {};

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (_) {}
      }
      console.error("[AI] Failed to parse tool arguments:", cleaned);
      return {};
    }
  }

  return {};
}

/**
 * Deep-parse any stringified JSON values in tool arguments.
 * Llama sometimes returns {transactions: "[{...}]"} instead of {transactions: [{...}]}
 */
export function deepParseArguments(args: any): any {
  if (typeof args !== "object" || args === null) return args;

  const result: any = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      const trimmed = (value as string).trim();
      if (
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith("{") && trimmed.endsWith("}"))
      ) {
        try {
          result[key] = JSON.parse(trimmed);
          console.log(
            `[AI] Deep-parsed string field "${key}": string → ${Array.isArray(result[key]) ? "array" : "object"}`
          );
          continue;
        } catch (_) {
          // Not valid JSON, keep as string
        }
      }
    }
    result[key] = value;
  }
  return result;
}

/**
 * Parse raw AI response into structured AIResult
 */
export function parseAIResponse(response: any): AIResult {
  const toolCalls: AIResult["toolCalls"] = [];
  let textResponse: string | null = null;

  let rawToolCalls: any[] = [];

  // Format A: OpenAI-compatible (choices[0].message.tool_calls)
  const choiceMessage = response.choices?.[0]?.message;
  if (choiceMessage?.tool_calls && Array.isArray(choiceMessage.tool_calls)) {
    rawToolCalls = choiceMessage.tool_calls;
    console.log(
      `[AI] Found ${rawToolCalls.length} tool_calls via choices[0].message.tool_calls`
    );
  }
  // Format B: Legacy Workers AI
  else if (response.tool_calls && Array.isArray(response.tool_calls)) {
    rawToolCalls = response.tool_calls;
    console.log(
      `[AI] Found ${rawToolCalls.length} tool_calls via response.tool_calls`
    );
  }

  for (const tc of rawToolCalls) {
    const name = tc.function?.name ?? tc.name;
    const rawArgs = tc.function?.arguments ?? tc.arguments;

    if (!name) {
      console.warn("[AI] Tool call without name:", JSON.stringify(tc));
      continue;
    }

    // Parse top-level arguments (string → object)
    let parsedArgs = parseToolArguments(rawArgs);
    // Deep-parse nested string fields (e.g. transactions: "[{...}]" → [{...}])
    parsedArgs = deepParseArguments(parsedArgs);

    console.log(`[AI] Tool call: ${name}`, JSON.stringify(parsedArgs));

    toolCalls.push({ name, arguments: parsedArgs });
  }

  let rawText =
    choiceMessage?.content ?? response.response ?? response.content ?? null;

  if (rawText && typeof rawText === "string") {
    textResponse = stripThinkingTags(rawText) || null;
  }

  return { toolCalls, textResponse };
}
