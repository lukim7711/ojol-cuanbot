/**
 * Input Guard — Prompt Injection Filter & Input Sanitization
 *
 * Strips known prompt injection patterns before user text reaches the AI.
 * Also enforces maximum input length to prevent token waste.
 *
 * This is a DEFENSE-IN-DEPTH layer. It does NOT replace proper
 * tool-level validation — it reduces the attack surface.
 *
 * Patterns filtered:
 * - "ignore/abaikan previous instructions" variants
 * - Role injection ("system:", "assistant:", "[INST]")
 * - "you are now..." / "kamu sekarang adalah..."
 * - Markdown/XML instruction blocks
 */

const MAX_INPUT_LENGTH = 500;

/**
 * Prompt injection patterns to strip from user input.
 * Each pattern removes the matched text, leaving the rest intact.
 * Order doesn't matter — all patterns are applied.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // English: "ignore all previous instructions/rules/prompts"
  /ignore\s+(all\s+)?(previous|above|prior|earlier|system)\s+(instructions?|rules?|prompts?|context)/gi,
  // Indonesian: "abaikan semua instruksi/aturan sebelumnya"
  /abaikan\s+(semua\s+)?(instruksi|aturan|perintah|prompt)\s+(sebelumnya|di\s*atas|lama)/gi,
  // Role injection: "system:", "assistant:", "[INST]", "<<SYS>>"
  /^(system|assistant)\s*:/gim,
  /\[\/?INST\]/gi,
  /<<\/?SYS>>/gi,
  // "You are now..." / "Kamu sekarang adalah..."
  /(you\s+are\s+now|kamu\s+sekarang\s+(adalah|jadi)|act\s+as|pretend\s+(to\s+be|you're))/gi,
  // "New instructions:" / "Override:" / "Forget everything"
  /(new\s+instructions?|override|forget\s+everything|reset\s+your\s+(role|persona|instructions?))/gi,
  // Markdown/XML instruction blocks that try to inject system context
  /```(system|instructions?|prompt)[\s\S]*?```/gi,
  /<(system|instructions?|prompt)>[\s\S]*?<\/\1>/gi,
];

/**
 * Sanitize user input before sending to AI pipeline.
 * Returns cleaned text, or null if input is empty after sanitization.
 */
export function sanitizeUserInput(text: string): string | null {
  // 1. Enforce max length
  let cleaned = text.substring(0, MAX_INPUT_LENGTH);

  // 2. Strip injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  // 3. Collapse excessive whitespace
  cleaned = cleaned.replace(/\s{3,}/g, "  ").trim();

  // 4. If nothing left after cleaning, return null
  if (cleaned.length === 0) {
    return null;
  }

  return cleaned;
}

/**
 * Check if the input contains suspicious injection patterns.
 * Returns true if patterns were found (for logging purposes).
 * The actual filtering is done by sanitizeUserInput().
 */
export function hasInjectionPatterns(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => {
    // Reset regex lastIndex since we use 'g' flag
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
