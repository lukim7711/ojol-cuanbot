// Re-export AI-related types from transaction.ts for convenience
export type { ToolCallResult } from "./transaction";

// Additional AI response types can be defined here as needed
export interface AIToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIResponse {
  toolCalls: AIToolCall[];
  textResponse: string | null;
}
