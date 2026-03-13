export class InstructionFirewall {
  // Regex patterns for dangerous operations
  private readonly rules = [
    { pattern: /rm\s+(-r|-f|-rf|-fr)\s+/i, reason: "Destructive file deletion" },
    { pattern: /drop\s+table/i, reason: "SQL Table Drop" },
    { pattern: /truncate\s+table/i, reason: "SQL Table Truncate" },
    { pattern: /shutdown/i, reason: "System Shutdown" },
    { pattern: /:(){:|&};:/, reason: "Fork Bomb" },
    { pattern: /wget\s+http/i, reason: "Unverified Download" },
    { pattern: /curl\s+http/i, reason: "Unverified Download" },
    { pattern: /chmod\s+777/i, reason: "Insecure Permissions" },
  ];

  analyze(input: string): string[] {
    const issues: string[] = [];

    // 1. Length Check
    if (input.length > 100000) {
      issues.push("Input size exceeds safety limit");
    }

    // 2. Pattern Matching
    for (const rule of this.rules) {
      if (rule.pattern.test(input)) {
        issues.push(rule.reason);
      }
    }

    // 3. Prompt Injection Heuristics (Simple)
    const lower = input.toLowerCase();
    if (
      lower.includes("ignore previous instructions") ||
      lower.includes("ignore all instructions")
    ) {
      issues.push("Potential Prompt Injection");
    }

    return issues;
  }
}

// Keep standalone function for legacy compatibility if needed
export function detectUnsafeIntent(text: string): string[] {
  return new InstructionFirewall().analyze(text);
}

export const defaultFirewall = new InstructionFirewall();
