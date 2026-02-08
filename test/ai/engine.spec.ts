import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──
vi.mock("../../src/ai/tools", () => ({
  TOOLS: [
    {
      type: "function",
      function: {
        name: "record_transactions",
        description: "test",
        parameters: { type: "object", properties: {} },
      },
    },
  ],
}));

vi.mock("../../src/ai/prompt", () => ({
  buildSystemPrompt: vi.fn((date: string) => `System prompt for ${date}`),
}));

// We test the pure utility functions by importing them.
// Since stripThinkingTags and parseToolArguments are not exported,
// we test them indirectly through runAI behavior.

import { runAI, AIResult } from "../../src/ai/engine";

// Helper: create mock env with AI.run returning given response
function createMockEnv(aiResponse: any) {
  return {
    BOT_TOKEN: "test-token",
    BOT_INFO: '{}',
    DB: {} as D1Database,
    AI: {
      run: vi.fn().mockResolvedValue(aiResponse),
    },
  } as any;
}

describe("runAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Format A: OpenAI-compatible (choices[0].message.tool_calls) ──
  it("extracts tool calls from OpenAI-compatible format", async () => {
    const env = createMockEnv({
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: "record_transactions",
              arguments: JSON.stringify({ transactions: [{ type: "income", amount: 59000 }] }),
            },
          }],
          content: null,
        },
      }],
    });

    const result = await runAI(env, 1, "dapet 59rb");

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("record_transactions");
    expect(result.toolCalls[0].arguments.transactions[0].amount).toBe(59000);
    expect(result.textResponse).toBeNull();
  });

  // ── Format B: Legacy (response.tool_calls) ──
  it("extracts tool calls from legacy format", async () => {
    const env = createMockEnv({
      tool_calls: [{
        name: "record_transactions",
        arguments: { transactions: [{ type: "expense", amount: 25000 }] },
      }],
    });

    const result = await runAI(env, 1, "makan 25rb");

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("record_transactions");
    // arguments already an object, should be passed through
    expect(result.toolCalls[0].arguments.transactions[0].amount).toBe(25000);
  });

  // ── Text response extraction ──
  it("extracts text response from choices[0].message.content", async () => {
    const env = createMockEnv({
      choices: [{
        message: {
          content: "Halo bos! Ada yang bisa dibantu?",
          tool_calls: [],
        },
      }],
    });

    const result = await runAI(env, 1, "halo");

    expect(result.toolCalls).toHaveLength(0);
    expect(result.textResponse).toBe("Halo bos! Ada yang bisa dibantu?");
  });

  it("extracts text response from response.response (fallback)", async () => {
    const env = createMockEnv({
      response: "Fallback text response",
    });

    const result = await runAI(env, 1, "halo");

    expect(result.textResponse).toBe("Fallback text response");
  });

  // ── <think> tag stripping ──
  it("strips <think> tags from text response", async () => {
    const env = createMockEnv({
      choices: [{
        message: {
          content: "<think>internal reasoning here</think>Halo bos!",
          tool_calls: [],
        },
      }],
    });

    const result = await runAI(env, 1, "halo");

    expect(result.textResponse).toBe("Halo bos!");
    expect(result.textResponse).not.toContain("<think>");
  });

  it("strips <think> tags from tool call arguments (string)", async () => {
    const argsWithThink = '<think>reasoning</think>{"transactions": [{"type": "income", "amount": 59000}]}';
    const env = createMockEnv({
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: "record_transactions",
              arguments: argsWithThink,
            },
          }],
          content: null,
        },
      }],
    });

    const result = await runAI(env, 1, "dapet 59rb");

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].arguments.transactions[0].amount).toBe(59000);
  });

  // ── No tool calls and no text ──
  it("returns empty result when AI returns nothing useful", async () => {
    const env = createMockEnv({});

    const result = await runAI(env, 1, "test");

    expect(result.toolCalls).toHaveLength(0);
    expect(result.textResponse).toBeNull();
  });

  // ── Multiple tool calls ──
  it("handles multiple tool calls in one response", async () => {
    const env = createMockEnv({
      choices: [{
        message: {
          tool_calls: [
            {
              function: {
                name: "record_transactions",
                arguments: JSON.stringify({ transactions: [] }),
              },
            },
            {
              function: {
                name: "record_transactions",
                arguments: JSON.stringify({ transactions: [] }),
              },
            },
          ],
          content: null,
        },
      }],
    });

    const result = await runAI(env, 1, "multi");

    expect(result.toolCalls).toHaveLength(2);
  });

  // ── Tool call without name is skipped ──
  it("skips tool calls without a name", async () => {
    const env = createMockEnv({
      choices: [{
        message: {
          tool_calls: [
            { function: { arguments: '{}' } },  // no name
            { function: { name: "record_transactions", arguments: '{}' } },
          ],
          content: null,
        },
      }],
    });

    const result = await runAI(env, 1, "test");

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("record_transactions");
  });

  // ── Malformed JSON arguments fallback ──
  it("returns empty object for unparseable arguments", async () => {
    const env = createMockEnv({
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name: "record_transactions",
              arguments: "this is not json at all",
            },
          }],
          content: null,
        },
      }],
    });

    const result = await runAI(env, 1, "test");

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].arguments).toEqual({});
  });
});
