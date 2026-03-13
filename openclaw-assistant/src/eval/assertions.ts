import type { EvalAssertion } from "./types.js";

export function evaluateAssertions(text: string, assertions?: EvalAssertion) {
  const t = String(text ?? "");
  if (!assertions) return { ok: true };
  const mustContain = Array.isArray(assertions.mustContain) ? assertions.mustContain : [];
  for (const s of mustContain) {
    const needle = String(s ?? "");
    if (needle && !t.includes(needle)) {
      return { ok: false, reason: `missing substring: ${needle}` };
    }
  }
  const mustNotContain = Array.isArray(assertions.mustNotContain) ? assertions.mustNotContain : [];
  for (const s of mustNotContain) {
    const needle = String(s ?? "");
    if (needle && t.includes(needle)) {
      return { ok: false, reason: `contains forbidden substring: ${needle}` };
    }
  }
  const regexMustMatch = Array.isArray(assertions.regexMustMatch) ? assertions.regexMustMatch : [];
  for (const pat of regexMustMatch) {
    const p = String(pat ?? "");
    if (!p) continue;
    const re = new RegExp(p, "i");
    if (!re.test(t)) return { ok: false, reason: `regex did not match: ${p}` };
  }
  return { ok: true };
}
