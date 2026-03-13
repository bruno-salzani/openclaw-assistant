export function sanitizeInput(text: string): string {
  // Remove control characters and normalize
  return text.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
}
