import { EvolverPatch, PatchReview } from "./types.js";

function containsAny(haystack: string, needles: string[]) {
  for (const n of needles) {
    if (haystack.includes(n)) return true;
  }
  return false;
}

export class PatchReviewer {
  review(patch: EvolverPatch): PatchReview {
    const reasons: string[] = [];
    const diff = patch.diff;

    if (!diff.includes("diff --git")) reasons.push("patch_invalid_format");
    if (diff.length < 20) reasons.push("patch_too_small");
    if (diff.length > 500_000) reasons.push("patch_too_large");

    const forbidden = [
      "OPENCLAW_X_ADMIN_TOKEN",
      "OPENCLAW_X_PUBLIC_TOKEN",
      "OPENCLAW_X_POSTGRES_URL",
      "OPENCLAW_X_REDIS_URL",
      "OPENCLAW_X_QDRANT_URL",
      "BEGIN RSA PRIVATE KEY",
      "PRIVATE KEY-----",
    ];
    if (containsAny(diff, forbidden)) reasons.push("patch_contains_sensitive_material");
    if (diff.includes("TODO")) reasons.push("patch_contains_todo");
    if (diff.includes("\n+//") || diff.includes("\n+/*") || diff.includes("\n+ *")) {
      reasons.push("patch_adds_comments");
    }

    const tooManyFiles = patch.filesTouched.length > 10;
    if (tooManyFiles) reasons.push("patch_touches_too_many_files");

    let risk: PatchReview["risk"] = "low";
    if (reasons.some((r) => r.includes("sensitive") || r.includes("too_large"))) risk = "high";
    else if (reasons.length > 0) risk = "medium";

    return { approved: reasons.length === 0, reasons, risk };
  }
}
